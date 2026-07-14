#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import {
  EDITIONS,
  HARNESSES,
  MEMORY_SETUPS,
  controlsFor,
  createPathfinderState,
  normalizeDiscovery,
  parseHarnessSelection,
  previewPageSize,
  render,
  serializeAssignments,
  transition
} from "./install-pathfinder.mjs";

export function decodeTerminalEvent(buffer, { flushEscape = false } = {}) {
  if (!buffer) return { type: "incomplete", length: 0 };
  if (buffer.startsWith("\x1b")) {
    const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([mM])/.exec(buffer);
    if (mouse) {
      return {
        type: "mouse",
        button: Number(mouse[1]),
        x: Number(mouse[2]),
        y: Number(mouse[3]),
        final: mouse[4],
        length: mouse[0].length
      };
    }
    const known = [
      ["\x1b[A", "up"], ["\x1b[B", "down"], ["\x1b[D", "left"], ["\x1b[C", "right"],
      ["\x1bOA", "up"], ["\x1bOB", "down"], ["\x1bOD", "left"], ["\x1bOC", "right"]
    ].find(([sequence]) => buffer.startsWith(sequence));
    if (known) return { type: "token", token: known[1], length: known[0].length };
    if (buffer.startsWith("\x1b[")) {
      const csi = /^\x1b\[[0-?]*[ -/]*[@-~]/.exec(buffer);
      return csi ? { type: "ignore", length: csi[0].length } : { type: "incomplete", length: 0 };
    }
    if (buffer.startsWith("\x1b]")) {
      const bell = buffer.indexOf("\u0007", 2);
      const stringTerminator = buffer.indexOf("\x1b\\", 2);
      const end = bell >= 0 && (stringTerminator < 0 || bell < stringTerminator) ? bell + 1 : stringTerminator >= 0 ? stringTerminator + 2 : -1;
      return end >= 0 ? { type: "ignore", length: end } : { type: "incomplete", length: 0 };
    }
    if (/^\x1b[P^_]/.test(buffer)) {
      const end = buffer.indexOf("\x1b\\", 2);
      return end >= 0 ? { type: "ignore", length: end + 2 } : { type: "incomplete", length: 0 };
    }
    if (buffer.startsWith("\x1bO")) return buffer.length >= 3 ? { type: "ignore", length: 3 } : { type: "incomplete", length: 0 };
    if (buffer.length === 1) return flushEscape ? { type: "token", token: "esc", length: 1 } : { type: "incomplete", length: 0 };
    return { type: "ignore", length: 2 };
  }
  const char = String.fromCodePoint(buffer.codePointAt(0));
  if (char === "\u0003") return { type: "token", token: "cancel", length: char.length };
  if (char === "\r" || char === "\n") return { type: "token", token: "enter", length: char.length };
  if (char === " ") return { type: "token", token: "space", length: char.length };
  if (char === "\u007f" || char === "\b") return { type: "token", token: "backspace", length: char.length };
  if (/^[^\u0000-\u001f\u007f]$/u.test(char)) return { type: "text", text: char, length: char.length };
  return { type: "ignore", length: char.length };
}

export function sgrMouseAction(event, { overlayOpen = false } = {}) {
  if (!event || event.type !== "mouse" || event.final !== "M") return { type: "ignore" };
  if (event.button === 64 || event.button === 65) {
    return overlayOpen ? { type: "page", delta: event.button === 64 ? -1 : 1 } : { type: "ignore" };
  }
  return event.button === 0 ? { type: "activate", x: event.x, y: event.y } : { type: "ignore" };
}

export function printableInputAction(text, { textFieldFocused = false, phase = "Discover", overlayOpen = false } = {}) {
  if (textFieldFocused) return { type: "input", text };
  if (text === "p") return { type: "token", token: "p" };
  if (text === "w") return { type: "token", token: "w" };
  if (text === "r" && phase === "Discover" && !overlayOpen) return { type: "token", token: "r" };
  if (text === "b") return { type: "token", token: "b" };
  if (text === "q") return { type: "token", token: "cancel" };
  return { type: "ignore" };
}

function parseHarnessStatus(raw = process.env.ALFRED_INSTALL_HARNESS_STATUS || "") {
  return new Map(raw.split(",").map((entry) => entry.split("=")).filter(([key, value]) => key && value));
}

const harnessStatus = parseHarnessStatus();
function readDiscovery(filePath) {
  if (!filePath) return normalizeDiscovery(null, harnessStatus);
  try {
    return normalizeDiscovery(JSON.parse(readFileSync(filePath, "utf8")), harnessStatus);
  } catch {
    return normalizeDiscovery(null, harnessStatus);
  }
}

let state = createPathfinderState({
  current: {
    edition: process.env.ALFRED_INSTALL_CURRENT_EDITION,
    harness: process.env.ALFRED_INSTALL_CURRENT_HARNESS,
    profile: process.env.ALFRED_INSTALL_CURRENT_PROFILE,
    memory: process.env.ALFRED_INSTALL_CURRENT_MEMORY,
    name: process.env.ALFRED_INSTALL_CURRENT_NAME,
    targetPath: process.env.ALFRED_INSTALL_CURRENT_PATH,
    apply: process.env.ALFRED_INSTALL_CURRENT_APPLY
  },
  harnessStatus,
  discovery: readDiscovery(process.env.ALFRED_INSTALL_DISCOVERY_FILE)
});
if (process.env.ALFRED_INSTALL_APP_TUI_SCRIPT) state = { ...state, compatibilityPlayback: true };

let lastRender = { text: "", hitRegions: [] };
let legacyPlayback = false;
let legacyFocus = 0;
let legacyHarnessFocus = 0;
let pendingInput = "";
const inputDecoder = new StringDecoder("utf8");

function dimensions() {
  return {
    columns: Number(process.env.ALFRED_INSTALL_APP_TUI_COLUMNS || process.stdout.columns || process.env.COLUMNS || 80),
    rows: Number(process.env.ALFRED_INSTALL_APP_TUI_ROWS || process.stdout.rows || process.env.LINES || 24)
  };
}

function colorEnabled(stream) {
  if (process.env.ALFRED_INSTALL_FORCE_COLOR === "1") return true;
  return Boolean(stream?.isTTY) && !Object.hasOwn(process.env, "NO_COLOR");
}

function screen(output = process.stdout) {
  const viewport = dimensions();
  if (state.overlay?.type === "preview") state = transition(state, { type: "PAGE", delta: 0, pageSize: previewPageSize(viewport) });
  lastRender = render(state, { ...viewport, color: colorEnabled(output) });
  return lastRender.text;
}

function dispatch(action) {
  state = transition(state, action);
}

function setValue(pair) {
  const index = pair.indexOf("=");
  if (index < 0) return;
  const key = pair.slice(0, index);
  const value = pair.slice(index + 1);
  if (key === "harness" || key === "harnesses") {
    dispatch({ type: "PATCH", key: "harnesses", value: parseHarnessSelection(value, harnessStatus) });
  } else if (key === "profiles") {
    dispatch({ type: "PATCH", key, value: value === "false" || value === "decide-later" ? "decide-later" : "runtime-profiles" });
  } else if (key === "modelApproval") {
    dispatch({ type: "PATCH", key: "modelWriteApproved", value });
  } else {
    dispatch({ type: "PATCH", key, value });
  }
}

function legacyRows() {
  const rows = ["edition", "harness"];
  if (state.decisions.edition === "coding" || state.decisions.edition === "full") rows.push("profiles");
  if (state.decisions.edition === "memory" || state.decisions.edition === "full") rows.push("memory");
  rows.push("name", "path", "apply", "submit");
  return rows;
}

function legacyCurrentRow() {
  const rows = legacyRows();
  legacyFocus = Math.max(0, Math.min(rows.length - 1, legacyFocus));
  return rows[legacyFocus];
}

function cycle(values, value, delta) {
  const index = Math.max(0, values.indexOf(value));
  return values[(index + delta + values.length) % values.length];
}

function legacyChange(delta) {
  const row = legacyCurrentRow();
  if (row === "edition") dispatch({ type: "PATCH", key: "edition", value: cycle(EDITIONS.map((item) => item.value), state.decisions.edition, delta) });
  if (row === "harness") legacyHarnessFocus = (legacyHarnessFocus + delta + HARNESSES.length) % HARNESSES.length;
  if (row === "memory") dispatch({ type: "PATCH", key: "memory", value: cycle(MEMORY_SETUPS.map((item) => item.value), state.decisions.memorySetup, delta) });
}

function legacyActivate() {
  const row = legacyCurrentRow();
  if (row === "harness") dispatch({ type: "TOGGLE_HARNESS", value: HARNESSES[legacyHarnessFocus]?.value || "opencode" });
  if (row === "profiles") dispatch({ type: "PATCH", key: "profiles", value: state.decisions.profileStrategy === "runtime-profiles" ? "decide-later" : "runtime-profiles" });
  if (row === "apply") dispatch({ type: "PATCH", key: "apply", value: !state.decisions.apply });
  if (row === "submit") state = { ...state, done: true };
}

function handleLegacyMouse(token) {
  const [, yText] = token.split(":");
  const y = Number(yText);
  if (!Number.isFinite(y)) return;
  legacyPlayback = true;
  const rows = legacyRows();
  legacyFocus = Math.max(0, Math.min(rows.length - 1, Math.floor((y - 5) / 4)));
  legacyActivate();
}

function handleLegacyToken(token) {
  const rows = legacyRows();
  if (token === "up" || token === "down") {
    legacyFocus = (legacyFocus + (token === "up" ? -1 : 1) + rows.length) % rows.length;
    return true;
  }
  if (token === "left" || token === "right") {
    legacyChange(token === "left" ? -1 : 1);
    return true;
  }
  if (token === "space" || token === "enter") {
    legacyActivate();
    return true;
  }
  if (token === "backspace") {
    const row = legacyCurrentRow();
    if (row === "name") dispatch({ type: "PATCH", key: "name", value: state.decisions.name.slice(0, -1) });
    if (row === "path") dispatch({ type: "PATCH", key: "path", value: state.decisions.targetPath.slice(0, -1) });
    return true;
  }
  if (token.startsWith("text:")) {
    const row = legacyCurrentRow();
    const text = token.slice(5).replace(/[\r\n]/g, "");
    if (row === "name") dispatch({ type: "PATCH", key: "name", value: `${state.decisions.name}${text}` });
    if (row === "path") dispatch({ type: "PATCH", key: "path", value: `${state.decisions.targetPath}${text}` });
    return true;
  }
  return false;
}

function handleInteractiveMouse(event) {
  const action = sgrMouseAction(event, { overlayOpen: Boolean(state.overlay) });
  if (action.type === "page") dispatch({ type: "PAGE", delta: action.delta, pageSize: previewPageSize(dimensions()) });
  if (action.type !== "activate") return;
  const region = lastRender.hitRegions.find((item) => action.x >= item.x1 && action.x <= item.x2 && action.y >= item.y1 && action.y <= item.y2);
  if (region) dispatch(region.action);
}

function textFocused() {
  return state.phase === "Configure" && ["name", "path"].includes(controlsFor(state)[state.focus]) && !state.overlay;
}

function handleToken(token, { playback = false } = {}) {
  if (!token || state.done) return;
  if (token.startsWith("set:")) return setValue(token.slice(4));
  if (token.startsWith("mouse:")) return playback ? handleLegacyMouse(token.slice(6)) : undefined;
  if (token === "submit") {
    state = { ...state, done: true };
    return;
  }
  if (playback && legacyPlayback && handleLegacyToken(token)) return;
  if (token === "cancel" || token === "q") return dispatch({ type: "CANCEL" });
  if (token === "p") return dispatch({ type: "OPEN_PREVIEW" });
  if (token === "w") return dispatch({ type: "OPEN_WHY" });
  if (token === "esc") return dispatch(state.overlay ? { type: "CLOSE_OVERLAY" } : { type: "BACK" });
  if (token === "r" && state.phase === "Discover" && !state.overlay) return dispatch({ type: "USE_RECOMMENDED" });
  if (token === "back" || token === "b") return dispatch({ type: "BACK" });
  if (token === "up") return dispatch(state.overlay ? { type: "PAGE", delta: -1, pageSize: previewPageSize(dimensions()) } : { type: "MOVE", delta: -1 });
  if (token === "down") return dispatch(state.overlay ? { type: "PAGE", delta: 1, pageSize: previewPageSize(dimensions()) } : { type: "MOVE", delta: 1 });
  if (token === "left") return dispatch(state.overlay ? { type: "PAGE", delta: -1, pageSize: previewPageSize(dimensions()) } : { type: "CHANGE", delta: -1 });
  if (token === "right") return dispatch(state.overlay ? { type: "PAGE", delta: 1, pageSize: previewPageSize(dimensions()) } : { type: "CHANGE", delta: 1 });
  if (token === "space" || token === "enter") return dispatch({ type: "ACTIVATE" });
  if (token === "backspace") return dispatch({ type: "BACKSPACE" });
  if (token.startsWith("text:")) return dispatch({ type: "INPUT", text: token.slice(5) });
}

function handleDecodedEvent(event) {
  if (event.type === "mouse") return handleInteractiveMouse(event);
  if (event.type === "token") return handleToken(event.token);
  if (event.type !== "text") return;
  const action = printableInputAction(event.text, {
    textFieldFocused: textFocused(),
    phase: state.phase,
    overlayOpen: Boolean(state.overlay)
  });
  if (action.type === "input") dispatch({ type: "INPUT", text: action.text });
  if (action.type === "token") handleToken(action.token);
}

function parseBytes(data, { flushEscape = false } = {}) {
  if (data?.length) pendingInput += Buffer.isBuffer(data) ? inputDecoder.write(data) : String(data);
  while (pendingInput) {
    const event = decodeTerminalEvent(pendingInput, { flushEscape });
    if (event.type === "incomplete") break;
    pendingInput = pendingInput.slice(event.length);
    handleDecodedEvent(event);
    if (state.done) break;
  }
}

function writeAssignments() {
  const output = serializeAssignments(state.decisions, { reviewVisited: state.reviewVisited });
  const resultFile = process.env.ALFRED_INSTALL_APP_TUI_RESULT_FILE;
  if (resultFile) writeFileSync(resultFile, output);
  else process.stdout.write(output);
}

function runPlayback() {
  const script = process.env.ALFRED_INSTALL_APP_TUI_EVENTS || process.env.ALFRED_INSTALL_APP_TUI_SCRIPT || "";
  for (const token of script.split(/[,\n]+/).map((item) => item.trim()).filter(Boolean)) handleToken(token, { playback: true });
  if (process.env.ALFRED_INSTALL_APP_TUI_RENDER === "1") process.stderr.write(`${screen(process.stderr)}\n`);
  if (state.cancelled) {
    process.exitCode = 130;
    return;
  }
  writeAssignments();
}

export async function runInteractive({ stdin = process.stdin, stdout = process.stdout } = {}) {
  if (!stdin.isTTY || !stdout.isTTY) {
    process.stderr.write("App TUI requires a TTY. Falling back to text installer.\n");
    process.exitCode = 2;
    return;
  }
  const wasRaw = Boolean(stdin.isRaw);
  let cleaned = false;
  let escapeTimer = null;
  let terminationCode = 0;
  let resolveSession;
  let rejectSession;
  let onData;
  const redraw = () => stdout.write(`\x1b[H\x1b[2J${screen(stdout)}`);
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (escapeTimer) clearTimeout(escapeTimer);
    try { stdout.write("\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l"); } catch {}
    try { if (stdin.isRaw !== wasRaw) stdin.setRawMode(wasRaw); } catch {}
    try { stdin.pause(); } catch {}
    try { stdin.unref?.(); } catch {}
  };
  const settle = () => {
    if (state.done) resolveSession?.();
    else redraw();
  };
  const flushEscape = () => {
    escapeTimer = null;
    try {
      parseBytes("", { flushEscape: true });
      settle();
    } catch (error) {
      rejectSession?.(error);
    }
  };
  const signalHandlers = new Map([
    ["SIGINT", () => { terminationCode = 130; dispatch({ type: "CANCEL" }); resolveSession?.(); }],
    ["SIGTERM", () => { terminationCode = 143; dispatch({ type: "CANCEL" }); resolveSession?.(); }],
    ["SIGHUP", () => { terminationCode = 129; dispatch({ type: "CANCEL" }); resolveSession?.(); }]
  ]);
  const onError = (error) => rejectSession?.(error);
  const session = new Promise((resolvePromise, rejectPromise) => {
    resolveSession = resolvePromise;
    rejectSession = rejectPromise;
    onData = (data) => {
      try {
        if (escapeTimer) {
          clearTimeout(escapeTimer);
          escapeTimer = null;
        }
        parseBytes(data);
        if (pendingInput === "\x1b") escapeTimer = setTimeout(flushEscape, 25);
        settle();
      } catch (error) {
        rejectPromise(error);
      }
    };
    stdin.on("data", onData);
    stdin.on("error", onError);
    stdout.on("error", onError);
    for (const [signal, handler] of signalHandlers) process.once(signal, handler);
  });
  try {
    stdin.setRawMode(true);
    stdin.resume();
    stdout.write("\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h");
    if (state.done) resolveSession();
    else redraw();
    await session;
  } finally {
    if (onData) stdin.off("data", onData);
    cleanup();
    stdin.off("error", onError);
    stdout.off("error", onError);
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
  }
  if (terminationCode) process.exitCode = terminationCode;
  else if (state.cancelled) process.exitCode = 130;
  else writeAssignments();
}

function canonicalPath(value) {
  try { return realpathSync(value); } catch { return resolve(value); }
}
const isMain = process.argv[1] && canonicalPath(process.argv[1]) === canonicalPath(fileURLToPath(import.meta.url));
if (isMain) {
  if (process.env.ALFRED_INSTALL_APP_TUI_EVENTS || process.env.ALFRED_INSTALL_APP_TUI_SCRIPT) runPlayback();
  else {
    try {
      await runInteractive();
    } catch (error) {
      process.stderr.write(`App TUI failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
