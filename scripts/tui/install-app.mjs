#!/usr/bin/env node
import { createHash } from "node:crypto";
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  EDITIONS,
  HARNESSES,
  MEMORY_SETUPS,
  controlsFor,
  createPathfinderState,
  normalizeTuiLayout,
  normalizeDiscovery,
  modelPlanForState,
  modelPlanReviewLines,
  parseHarnessSelection,
  previewPageSize,
  render,
  sanitizeTerminalOutput,
  serializeAssignments,
  stripAnsi,
  terminalPhysicalRows,
  textEditingActive,
  transition,
  validateCustomModelsDraft
} from "./install-pathfinder.mjs";
import { catalogErrorCategory, fetchCatalog } from "./models-dev-catalog.mjs";

const MAX_CATALOG_EVENT_BYTES = 8 * 1024;
// Shell aggregation accepts at most six declines plus one allow and completion.
const MAX_CATALOG_EVENTS = 8;
const CATALOG_BUCKETS = Object.freeze({
  bytes: [
    [0, "none"], [64 * 1024, "under-64k"], [1024 * 1024, "64k-1m"], [4 * 1024 * 1024, "1m-4m"], [Infinity, "4m-8m"]
  ],
  count: [[0, "none"], [10, "1-10"], [100, "11-100"], [1000, "101-1000"], [Infinity, "1001-plus"]],
  duration: [[100, "under-100ms"], [500, "100-499ms"], [1000, "500-999ms"], [5000, "1-5s"], [Infinity, "over-5s"]]
});

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
    if (buffer.startsWith("\x1b[3~")) return { type: "token", token: "delete", length: 4 };
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

function numericBucket(value, ranges, none = "none") {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return none;
  for (const [maximum, label] of ranges) if (number <= maximum) return label;
  return ranges.at(-1)?.[1] ?? none;
}

function catalogEventForConsent(consent) {
  return { event: "catalog_consent_decided", consent: consent === "allowed" ? "allowed" : "declined" };
}

function catalogEventForResult(result) {
  return {
    event: "catalog_fetch_completed",
    outcome: "success",
    bytes_bucket: numericBucket(result?.stats?.bytes, CATALOG_BUCKETS.bytes.slice(1)),
    provider_count_bucket: numericBucket(result?.stats?.providers, CATALOG_BUCKETS.count.slice(1)),
    model_count_bucket: numericBucket(result?.stats?.models, CATALOG_BUCKETS.count.slice(1)),
    duration_bucket: numericBucket(result?.stats?.duration_ms, CATALOG_BUCKETS.duration),
    catalog_metadata_requests: result?.metadata_requests === 1 ? 1 : 0
  };
}

function catalogEventForFailure(error) {
  const category = catalogErrorCategory(error);
  const metadataRequests = error?.metadata_requests === 1 ? 1 : 0;
  return {
    event: "catalog_fetch_completed",
    outcome: category === "aborted" && metadataRequests === 0 ? "aborted-before-request" : category,
    bytes_bucket: "none",
    provider_count_bucket: "none",
    model_count_bucket: "none",
    duration_bucket: "none",
    catalog_metadata_requests: metadataRequests
  };
}

function validateCatalogEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("invalid catalog event");
  if (event.event === "catalog_consent_decided") {
    if (JSON.stringify(Object.keys(event).sort()) !== JSON.stringify(["consent", "event"]) || !["allowed", "declined"].includes(event.consent)) throw new Error("invalid catalog consent event");
    return event;
  }
  const keys = ["bytes_bucket", "catalog_metadata_requests", "duration_bucket", "event", "model_count_bucket", "outcome", "provider_count_bucket"];
  if (event.event !== "catalog_fetch_completed" || JSON.stringify(Object.keys(event).sort()) !== JSON.stringify(keys)) throw new Error("invalid catalog fetch event");
  const outcomes = new Set(["success", "timeout", "aborted", "aborted-before-request", "network", "http", "redirect", "content-type", "oversized", "malformed", "schema"]);
  const byteBuckets = new Set(["none", "under-64k", "64k-1m", "1m-4m", "4m-8m"]);
  const countBuckets = new Set(["none", "1-10", "11-100", "101-1000", "1001-plus"]);
  const durationBuckets = new Set(["none", "under-100ms", "100-499ms", "500-999ms", "1-5s", "over-5s"]);
  const expectedMetadataRequests = event.outcome === "aborted-before-request" ? 0 : 1;
  if (!outcomes.has(event.outcome) || !byteBuckets.has(event.bytes_bucket) || !countBuckets.has(event.provider_count_bucket) || !countBuckets.has(event.model_count_bucket) || !durationBuckets.has(event.duration_bucket) || event.catalog_metadata_requests !== expectedMetadataRequests) throw new Error("invalid catalog fetch event");
  return event;
}

export function appendCatalogEvent(filePath, event) {
  if (!filePath) throw new Error("catalog event file is unavailable");
  const target = resolve(filePath);
  const parent = dirname(target);
  if (basename(target) !== "catalog-events.jsonl") throw new Error("catalog event path must use the fixed filename");
  const effectiveUid = typeof process.geteuid === "function" ? process.geteuid() : null;
  const parentStats = lstatSync(parent);
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink() || (parentStats.mode & 0o777) !== 0o700) throw new Error("catalog event parent is not private");
  if (effectiveUid !== null && parentStats.uid !== effectiveUid) throw new Error("catalog event parent ownership is invalid");
  const pathStats = lstatSync(target);
  if (!pathStats.isFile() || pathStats.isSymbolicLink() || (pathStats.mode & 0o777) !== 0o600) throw new Error("catalog event file is not private");
  if (effectiveUid !== null && pathStats.uid !== effectiveUid) throw new Error("catalog event ownership is invalid");
  const line = `${JSON.stringify(validateCatalogEvent(event))}\n`;
  if (Buffer.byteLength(line) > 1024) throw new Error("catalog event is too large");
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  let descriptor;
  try {
    descriptor = openSync(target, constants.O_RDWR | constants.O_APPEND | noFollow);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || (opened.mode & 0o777) !== 0o600 || opened.dev !== pathStats.dev || opened.ino !== pathStats.ino) throw new Error("catalog event file changed before append");
    if (effectiveUid !== null && opened.uid !== effectiveUid) throw new Error("catalog event ownership is invalid");
    if (opened.size + Buffer.byteLength(line) > MAX_CATALOG_EVENT_BYTES) throw new Error("catalog event file is full");
    const existing = opened.size ? readFileSync(descriptor, "utf8") : "";
    if (existing && !existing.endsWith("\n")) throw new Error("catalog event file is malformed");
    const count = existing ? existing.split("\n").length - 1 : 0;
    if (count >= MAX_CATALOG_EVENTS) throw new Error("catalog event count exceeded");
    writeFileSync(descriptor, line);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function createCatalogRequestCoordinator({
  fetchCatalogImpl = fetchCatalog,
  eventsFile = process.env.ALFRED_INSTALL_CATALOG_EVENTS_FILE,
  onDispatch = () => {},
  onRedraw = () => {}
} = {}) {
  let decisionNonce = 0;
  let declineRecorded = false;
  let requestStarted = false;
  let pending = null;
  const controller = new AbortController();
  const safeDispatch = (action) => { onDispatch(action); onRedraw(); };
  return {
    observe(currentState) {
      const catalog = currentState?.catalog;
      if (!catalog) return;
      if (catalog.decisionNonce > decisionNonce) {
        decisionNonce = catalog.decisionNonce;
        const repeatedDecline = catalog.consent === "declined" && declineRecorded;
        if (!repeatedDecline) {
          try {
            appendCatalogEvent(eventsFile, catalogEventForConsent(catalog.consent));
            if (catalog.consent === "declined") declineRecorded = true;
          } catch {
            if (catalog.consent === "allowed") safeDispatch({ type: "CATALOG_REQUEST_FAILED", nonce: catalog.requestNonce, category: "trace" });
            return;
          }
        }
      }
      if (requestStarted || catalog.status !== "requested" || catalog.consent !== "allowed") return;
      requestStarted = true;
      const nonce = catalog.requestNonce;
      safeDispatch({ type: "CATALOG_REQUEST_STARTED", nonce });
      pending = Promise.resolve()
        .then(() => fetchCatalogImpl({ signal: controller.signal }))
        .then((result) => {
          try {
            appendCatalogEvent(eventsFile, catalogEventForResult(result));
          } catch {
            safeDispatch({ type: "CATALOG_REQUEST_FAILED", nonce, category: "trace" });
            return;
          }
          safeDispatch({ type: "CATALOG_REQUEST_SUCCEEDED", nonce, result });
        }, (error) => {
          try {
            appendCatalogEvent(eventsFile, catalogEventForFailure(error));
          } catch {
            safeDispatch({ type: "CATALOG_REQUEST_FAILED", nonce, category: "trace" });
            return;
          }
          safeDispatch({ type: "CATALOG_REQUEST_FAILED", nonce, category: catalogErrorCategory(error) });
        });
    },
    abort() { controller.abort(); },
    wait() { return pending ?? Promise.resolve(); },
    get requestStarted() { return requestStarted; }
  };
}

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
const selectedTuiLayout = normalizeTuiLayout(process.env.ALFRED_INSTALL_APP_TUI_LAYOUT);
let catalogCoordinator = null;

function dimension(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return Math.max(0, Math.floor(number));
  }
  return 0;
}

function dimensions(output = process.stdout) {
  return {
    columns: dimension(process.env.ALFRED_INSTALL_APP_TUI_COLUMNS, output?.columns, process.env.COLUMNS, 80),
    rows: dimension(process.env.ALFRED_INSTALL_APP_TUI_ROWS, output?.rows, process.env.LINES, 24)
  };
}

function colorEnabled(stream) {
  if (process.env.ALFRED_INSTALL_FORCE_COLOR === "1") return true;
  return Boolean(stream?.isTTY) && !Object.hasOwn(process.env, "NO_COLOR");
}

function screen(output = process.stdout, layout = selectedTuiLayout, viewport = dimensions(output)) {
  if (state.overlay?.type === "preview") state = transition(state, { type: "PAGE", delta: 0, pageSize: previewPageSize(viewport) });
  if (state.overlay?.type === "model-plan-review") {
    const width = normalizeTuiLayout(layout) === "inline" ? Math.max(0, viewport.columns - 1) : viewport.columns;
    const contentWidth = Math.max(1, width - 2);
    const totalItems = modelPlanReviewLines(state, contentWidth).length;
    state = transition(state, { type: "PAGE", delta: 0, pageSize: previewPageSize(viewport), totalItems, inspectionKey: `${contentWidth}:${totalItems}` });
  }
  lastRender = render(state, { ...viewport, color: colorEnabled(output), layout });
  return lastRender.text;
}

function cursorUp(rows) {
  return rows > 0 ? `\x1b[${rows}A` : "";
}

export function inlineFrameInfo(text, { columns = 0, rows = 0 } = {}) {
  const value = sanitizeTerminalOutput(text);
  const logicalLines = value === "" ? [] : value.split("\n").map((line) => {
    const plainText = stripAnsi(line);
    return { text: plainText };
  });
  return {
    columns: dimension(columns),
    rows: dimension(rows),
    text: logicalLines.map(({ text: line }) => line).join("\n"),
    logicalLines
  };
}

export function inlinePhysicalRows(frame, columns = frame?.columns) {
  if (typeof frame === "number") return Math.max(0, Math.floor(frame));
  if (!frame?.logicalLines?.length) return 0;
  const width = dimension(columns);
  if (width === 0) return 0;
  const text = typeof frame.text === "string" ? frame.text : frame.logicalLines.map((line) => line.text || "").join("\n");
  return terminalPhysicalRows(text, width);
}

export function inlineRedrawSequence(text, previousFrame = null, currentColumns = previousFrame?.columns) {
  const value = sanitizeTerminalOutput(text);
  const lines = value === "" ? [] : value.split("\n");
  const oldRows = inlinePhysicalRows(previousFrame, currentColumns);
  if (oldRows === 0) return value;
  const totalRows = Math.max(oldRows, lines.length);
  let output = `\r${cursorUp(oldRows - 1)}`;
  for (let index = 0; index < totalRows; index += 1) {
    output += "\x1b[2K";
    if (index < lines.length) output += lines[index];
    if (index < totalRows - 1) output += "\r\n";
  }
  const targetRow = Math.max(0, lines.length - 1);
  output += `\r${cursorUp(totalRows - 1 - targetRow)}`;
  return output;
}

export function inlineClearSequence(ownedFrame = null, currentColumns = ownedFrame?.columns) {
  const rows = inlinePhysicalRows(ownedFrame, currentColumns);
  if (rows === 0) return "";
  let output = `\r${cursorUp(rows - 1)}`;
  for (let index = 0; index < rows; index += 1) {
    output += "\x1b[2K";
    if (index < rows - 1) output += "\r\n";
  }
  return `${output}\r${cursorUp(rows - 1)}`;
}

function dispatch(action) {
  state = transition(state, action);
  if (state.done) catalogCoordinator?.abort();
  else catalogCoordinator?.observe(state);
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
  return textEditingActive(state) || ["catalog-providers", "catalog-models"].includes(state.overlay?.type);
}

function pagedOverlay(state) {
  return ["why", "preview", "model-plan-review"].includes(state?.overlay?.type);
}

export function terminalTokenAction(currentState, token, pageSize = 8) {
  if (["catalog-providers", "catalog-models"].includes(currentState.overlay?.type) && token === "space") return { type: "CATALOG_INPUT", text: " " };
  if (["catalog-consent", "catalog-loading", "catalog-providers", "catalog-models", "catalog-target"].includes(currentState.overlay?.type) && token === "esc") return { type: "CATALOG_BACK" };
  if (token === "esc") return currentState.editing
    ? { type: "ESCAPE" }
    : currentState.overlay
      ? { type: "CLOSE_OVERLAY" }
      : { type: "BACK" };
  if (token === "up" || token === "down") {
    if (["catalog-providers", "catalog-models"].includes(currentState.overlay?.type)) return { type: "CATALOG_MOVE", delta: token === "up" ? -1 : 1, pageSize };
    if (["catalog-consent", "catalog-target"].includes(currentState.overlay?.type)) return { type: "MOVE", delta: token === "up" ? -1 : 1 };
    if (pagedOverlay(currentState)) return { type: "PAGE", delta: token === "up" ? -1 : 1, pageSize };
    if (!currentState.overlay || currentState.overlay.type === "model-editor") return { type: "MOVE", delta: token === "up" ? -1 : 1 };
    return null;
  }
  if (token === "left" || token === "right") {
    if (["catalog-providers", "catalog-models"].includes(currentState.overlay?.type)) return { type: "CATALOG_PAGE", delta: token === "left" ? -1 : 1, pageSize };
    if (pagedOverlay(currentState)) return { type: "PAGE", delta: token === "left" ? -1 : 1, pageSize };
    if (!currentState.overlay || currentState.overlay.type === "model-editor") return { type: "CHANGE", delta: token === "left" ? -1 : 1 };
    return null;
  }
  return null;
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
  if (token === "esc") return dispatch(terminalTokenAction(state, token, previewPageSize(dimensions())));
  if (token === "r" && state.phase === "Discover" && !state.overlay) return dispatch({ type: "USE_RECOMMENDED" });
  if (token === "back" || token === "b") return dispatch({ type: "BACK" });
  if (["up", "down", "left", "right"].includes(token)) {
    const action = terminalTokenAction(state, token, previewPageSize(dimensions()));
    return action ? dispatch(action) : undefined;
  }
  if (token === "space") return dispatch(terminalTokenAction(state, token, previewPageSize(dimensions())) ?? { type: "SPACE" });
  if (token === "enter") return dispatch({ type: "ACTIVATE" });
  if (token === "backspace") return dispatch({ type: "BACKSPACE" });
  if (token === "delete") return dispatch({ type: "DELETE" });
  if (token.startsWith("text:")) return dispatch({ type: "INPUT", text: token.slice(5) });
}

function handleDecodedEvent(event, { mouseEnabled = true } = {}) {
  if (event.type === "mouse") return mouseEnabled ? handleInteractiveMouse(event) : undefined;
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

function parseBytes(data, { flushEscape = false, mouseEnabled = true } = {}) {
  if (data?.length) pendingInput += Buffer.isBuffer(data) ? inputDecoder.write(data) : String(data);
  while (pendingInput) {
    const event = decodeTerminalEvent(pendingInput, { flushEscape });
    if (event.type === "incomplete") break;
    pendingInput = pendingInput.slice(event.length);
    handleDecodedEvent(event, { mouseEnabled });
    if (state.done) break;
  }
}

function restrictedModelPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw new Error("invalid model plan");
  if (JSON.stringify(Object.keys(plan).sort()) !== JSON.stringify(["models", "provider_calls", "schema", "strategy"])) throw new Error("model plan has unknown keys");
  if (plan.schema !== "alfred.install.model-plan/v1" || plan.strategy !== "custom-models" || plan.provider_calls !== 0) throw new Error("invalid model plan contract");
  const keys = Object.keys(plan.models ?? {});
  if (keys.some((key) => !["*", "orchestrator", "developer", "fallbacks"].includes(key)) || !Object.hasOwn(plan.models ?? {}, "*") || !Object.hasOwn(plan.models ?? {}, "fallbacks")) throw new Error("invalid models keys");
  for (const key of ["*", "orchestrator", "developer"]) {
    if (!Object.hasOwn(plan.models, key)) continue;
    const entry = plan.models[key];
    if (!entry || Array.isArray(entry) || typeof entry !== "object" || JSON.stringify(Object.keys(entry)) !== JSON.stringify(["primary"])) throw new Error(`invalid ${key} model entry`);
  }
  if (!Array.isArray(plan.models.fallbacks)) throw new Error("invalid global fallbacks");
  return plan;
}

export function writePrivateModelPlan(filePath, plan) {
  const target = resolve(filePath);
  const parent = dirname(target);
  if (basename(target) !== "model-plan.json") throw new Error("model plan path must use the fixed model-plan.json filename");
  const effectiveUid = typeof process.geteuid === "function" ? process.geteuid() : null;
  const parentStats = lstatSync(parent);
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) throw new Error("model plan parent must be a regular non-symlink directory");
  if ((parentStats.mode & 0o777) !== 0o700) throw new Error("model plan parent must have private mode 0700");
  if (effectiveUid !== null && parentStats.uid !== effectiveUid) throw new Error("model plan parent must be owned by the effective uid");
  const existing = lstatSync(target);
  if (!existing.isFile() || existing.isSymbolicLink()) throw new Error("model plan target must be a regular non-symlink file");
  if ((existing.mode & 0o777) !== 0o600) throw new Error("model plan target must have mode 0600");
  if (effectiveUid !== null && existing.uid !== effectiveUid) throw new Error("model plan target must be owned by the effective uid");
  const bytes = Buffer.from(`${JSON.stringify(restrictedModelPlan(plan), null, 2)}\n`, "utf8");
  const temporaryPath = join(parent, `.${basename(target)}.${process.pid}.${Date.now()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, target);
    const directoryDescriptor = openSync(parent, constants.O_RDONLY);
    try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
  } catch (error) {
    if (descriptor !== undefined) try { closeSync(descriptor); } catch {}
    try { unlinkSync(temporaryPath); } catch {}
    throw error;
  }
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function writeAssignments() {
  if (state.decisions.modelStrategy === "custom-models" && validateCustomModelsDraft(state.decisions.customModels).status !== "pass") throw new Error("custom model plan is invalid; edit it or choose Configure models later");
  const plan = modelPlanForState(state);
  let modelPlanSha256 = "";
  if (plan) {
    const planPath = process.env.ALFRED_INSTALL_MODEL_PLAN_FILE;
    if (!planPath) throw new Error("approved custom model plan path is unavailable");
    const modulePath = join(dirname(fileURLToPath(import.meta.url)), "model-assignment.mjs");
    const canonicalPath = (() => { try { return realpathSync(modulePath); } catch { return resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/core/src/model-assignment.js"); } })();
    const { validateModelsConfig } = await import(pathToFileURL(canonicalPath).href);
    const validation = validateModelsConfig(plan.models);
    if (validation.status !== "pass") throw new Error(`invalid custom model plan: ${validation.errors.join("; ")}`);
    modelPlanSha256 = writePrivateModelPlan(planPath, plan).sha256;
  }
  const output = serializeAssignments(state.decisions, { reviewVisited: state.reviewVisited, modelRevision: state.modelRevision, reviewedModelRevision: state.reviewedModelRevision, modelInspection: state.modelInspection, modelPlanSha256 });
  const resultFile = process.env.ALFRED_INSTALL_APP_TUI_RESULT_FILE;
  if (resultFile) writeFileSync(resultFile, output);
  else process.stdout.write(output);
}

export async function runPlayback({ fetchCatalogImpl = fetchCatalog, catalogEventsFile = process.env.ALFRED_INSTALL_CATALOG_EVENTS_FILE } = {}) {
  catalogCoordinator = createCatalogRequestCoordinator({
    fetchCatalogImpl,
    eventsFile: catalogEventsFile,
    onDispatch: (action) => { if (!state.done) state = transition(state, action); }
  });
  const script = process.env.ALFRED_INSTALL_APP_TUI_EVENTS || process.env.ALFRED_INSTALL_APP_TUI_SCRIPT || "";
  const tokens = script.split(/[,\n]+/).flatMap((item) => {
    const withoutLeadingSeparatorSpace = item.replace(/^\s+/, "");
    if (/^set:model(?:Wildcard|Orchestrator|Developer|Fallback)=/.test(withoutLeadingSeparatorSpace)) return [withoutLeadingSeparatorSpace];
    const token = item.trim();
    return token ? [token] : [];
  });
  try {
    for (const token of tokens) {
      if (token === "catalog-wait") await catalogCoordinator.wait();
      else handleToken(token, { playback: true });
    }
    if (process.env.ALFRED_INSTALL_APP_TUI_RENDER === "1") process.stderr.write(`${screen(process.stderr)}\n`);
    if (state.cancelled) {
      process.exitCode = 130;
      return;
    }
    await writeAssignments();
  } finally {
    if (state.cancelled) catalogCoordinator.abort();
    catalogCoordinator = null;
  }
}

export async function runInteractive({
  stdin = process.stdin,
  stdout = process.stdout,
  layout: layoutInput = selectedTuiLayout,
  fetchCatalogImpl = fetchCatalog,
  catalogEventsFile = process.env.ALFRED_INSTALL_CATALOG_EVENTS_FILE
} = {}) {
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
  let onResize;
  let ownedFrame = null;
  const layout = normalizeTuiLayout(layoutInput);
  const fullscreen = layout === "fullscreen";
  const mouseEnabled = fullscreen;
  const redraw = () => {
    const viewport = dimensions(stdout);
    if (!fullscreen && (viewport.columns === 0 || viewport.rows === 0)) return;
    const content = screen(stdout, layout, viewport);
    if (fullscreen) stdout.write(`\x1b[H\x1b[2J${content}`);
    else {
      stdout.write(inlineRedrawSequence(content, ownedFrame, viewport.columns));
      ownedFrame = inlineFrameInfo(content, viewport);
    }
  };
  catalogCoordinator = createCatalogRequestCoordinator({
    fetchCatalogImpl,
    eventsFile: catalogEventsFile,
    onDispatch: (action) => { if (!state.done) state = transition(state, action); },
    onRedraw: () => { if (!state.done) redraw(); }
  });
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (escapeTimer) clearTimeout(escapeTimer);
    try {
      if (fullscreen) stdout.write("\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l");
      else stdout.write(`${inlineClearSequence(ownedFrame, dimensions(stdout).columns)}\x1b[?25h`);
    } catch {}
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
      parseBytes("", { flushEscape: true, mouseEnabled });
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
        parseBytes(data, { mouseEnabled });
        if (pendingInput === "\x1b") escapeTimer = setTimeout(flushEscape, 25);
        settle();
      } catch (error) {
        rejectPromise(error);
      }
    };
    stdin.on("data", onData);
    stdin.on("error", onError);
    stdout.on("error", onError);
    onResize = () => {
      try { if (!state.done) redraw(); } catch (error) { rejectPromise(error); }
    };
    stdout.on("resize", onResize);
    for (const [signal, handler] of signalHandlers) process.once(signal, handler);
  });
  try {
    stdin.setRawMode(true);
    stdin.resume();
    stdout.write(fullscreen ? "\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h" : "\x1b[?25l");
    if (state.done) resolveSession();
    else redraw();
    await session;
  } finally {
    catalogCoordinator?.abort();
    if (onData) stdin.off("data", onData);
    cleanup();
    stdin.off("error", onError);
    stdout.off("error", onError);
    if (onResize) stdout.off("resize", onResize);
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    catalogCoordinator = null;
  }
  if (terminationCode) process.exitCode = terminationCode;
  else if (state.cancelled) process.exitCode = 130;
  else await writeAssignments();
}

function canonicalPath(value) {
  try { return realpathSync(value); } catch { return resolve(value); }
}
const isMain = process.argv[1] && canonicalPath(process.argv[1]) === canonicalPath(fileURLToPath(import.meta.url));
if (isMain) {
  if (process.env.ALFRED_INSTALL_APP_TUI_EVENTS || process.env.ALFRED_INSTALL_APP_TUI_SCRIPT) await runPlayback();
  else {
    try {
      await runInteractive();
    } catch (error) {
      process.stderr.write(`App TUI failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
