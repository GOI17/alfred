#!/usr/bin/env node
import {
  BoxRenderable,
  CliRenderEvents,
  MouseButton,
  TextRenderable,
  createCliRenderer
} from "@opentui/core";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validateModelsConfig } from "../../core/src/model-assignment.js";
import {
  controlsFor,
  createPathfinderState,
  modelPlanForState,
  modelPlanReviewLines,
  normalizeDiscovery,
  previewPageSize,
  render,
  serializeAssignments,
  stripAnsi,
  textEditingActive,
  transition
} from "../../../scripts/tui/install-pathfinder.mjs";
import { writePrivateModelPlan } from "../../../scripts/tui/install-model-plan.mjs";

const THEME = Object.freeze({
  background: "#1f1f28",
  foreground: "#dcd7ba",
  muted: "#727169",
  blue: "#7e9cd8",
  green: "#98bb6c",
  yellow: "#e6c384",
  red: "#e46876"
});

function parseHarnessStatus(raw = "") {
  return new Map(String(raw).split(",").map((entry) => entry.split("=")).filter(([key, value]) => key && value));
}

function readDiscovery(filePath, harnessStatus) {
  if (!filePath) return normalizeDiscovery(null, harnessStatus);
  try {
    return normalizeDiscovery(JSON.parse(readFileSync(filePath, "utf8")), harnessStatus);
  } catch {
    return normalizeDiscovery(null, harnessStatus);
  }
}

export function createInstallerState(environment = process.env) {
  const harnessStatus = parseHarnessStatus(environment.ALFRED_INSTALL_HARNESS_STATUS);
  return createPathfinderState({
    current: {
      edition: environment.ALFRED_INSTALL_CURRENT_EDITION,
      harness: environment.ALFRED_INSTALL_CURRENT_HARNESS,
      profile: environment.ALFRED_INSTALL_CURRENT_PROFILE,
      memory: environment.ALFRED_INSTALL_CURRENT_MEMORY,
      name: environment.ALFRED_INSTALL_CURRENT_NAME,
      targetPath: environment.ALFRED_INSTALL_CURRENT_PATH,
      apply: environment.ALFRED_INSTALL_CURRENT_APPLY
    },
    harnessStatus,
    discovery: readDiscovery(environment.ALFRED_INSTALL_DISCOVERY_FILE, harnessStatus)
  });
}

function overlayPaged(state) {
  return ["why", "preview", "model-plan-review"].includes(state?.overlay?.type);
}

export function keyEventAction(key, state, viewport = { columns: 80, rows: 24 }) {
  if (!key || key.eventType === "release") return null;
  const name = key.name === "return" ? "enter" : key.name;
  if (key.ctrl && name === "c") return { type: "CANCEL" };
  if (name === "escape") {
    if (state.editing) return { type: "ESCAPE" };
    if (state.overlay) return { type: "CLOSE_OVERLAY" };
    return { type: "BACK" };
  }
  if (name === "up" || name === "down") {
    if (overlayPaged(state)) return { type: "PAGE", delta: name === "up" ? -1 : 1, pageSize: previewPageSize(viewport) };
    if (!state.overlay || state.overlay.type === "model-editor") return { type: "MOVE", delta: name === "up" ? -1 : 1 };
    return null;
  }
  if (name === "left" || name === "right") {
    if (overlayPaged(state)) return { type: "PAGE", delta: name === "left" ? -1 : 1, pageSize: previewPageSize(viewport) };
    if (!state.overlay || state.overlay.type === "model-editor") return { type: "CHANGE", delta: name === "left" ? -1 : 1 };
    return null;
  }
  if (name === "enter") return { type: "ACTIVATE" };
  if (name === "space") return { type: "SPACE" };
  if (name === "backspace") return { type: "BACKSPACE" };
  if (name === "delete") return { type: "DELETE" };

  const printable = typeof key.sequence === "string" &&
    key.sequence.length > 0 &&
    !key.ctrl &&
    !key.meta &&
    !key.option &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(key.sequence)
    ? key.sequence
    : "";
  if (!printable) return null;
  if (textEditingActive(state)) return { type: "INPUT", text: printable };
  if (printable === "q") return { type: "CANCEL" };
  if (printable === "p") return { type: "OPEN_PREVIEW" };
  if (printable === "w") return { type: "OPEN_WHY" };
  if (printable === "b") return { type: "BACK" };
  if (printable === "r" && state.phase === "Discover" && !state.overlay) return { type: "USE_RECOMMENDED" };
  return null;
}

export function lineTone(line, lineIndex, totalLines) {
  const text = stripAnsi(line);
  if (lineIndex === 0 || /^\s*>/.test(text)) return "blue";
  if (/blocker|error|failed|unavailable/i.test(text)) return "red";
  if (/warning|\[changed\]|approval|required|not inspected/i.test(text)) return "yellow";
  if (/✓|installed|available|approved|ready|provider calls:\s*0/i.test(text)) return "green";
  if (lineIndex >= Math.max(1, totalLines - 3) || /^\s*$/.test(text)) return "muted";
  return "foreground";
}

function colorForTone(tone) {
  return THEME[tone] ?? THEME.foreground;
}

function normalizePagedState(state, viewport) {
  if (state.overlay?.type === "preview") {
    return transition(state, { type: "PAGE", delta: 0, pageSize: previewPageSize(viewport) });
  }
  if (state.overlay?.type === "model-plan-review") {
    const contentWidth = Math.max(1, viewport.columns - 2);
    const totalItems = modelPlanReviewLines(state, contentWidth).length;
    return transition(state, {
      type: "PAGE",
      delta: 0,
      pageSize: previewPageSize(viewport),
      totalItems,
      inspectionKey: `${contentWidth}:${totalItems}`
    });
  }
  return state;
}

export function frameForState(state, viewport = { columns: 80, rows: 24 }) {
  const normalized = normalizePagedState(state, viewport);
  const frame = render(normalized, { ...viewport, color: false, layout: "fullscreen" });
  return {
    state: normalized,
    lines: stripAnsi(frame.text).split("\n"),
    hitRegions: frame.hitRegions,
    provider_calls: 0
  };
}

export function assignmentsForState(state, environment = process.env) {
  const plan = modelPlanForState(state);
  let modelPlanSha256 = "";
  if (plan) {
    const validation = validateModelsConfig(plan.models);
    if (validation.status !== "pass") throw new Error(`invalid custom model plan: ${validation.errors.join("; ")}`);
    const planPath = environment.ALFRED_INSTALL_MODEL_PLAN_FILE;
    if (!planPath) throw new Error("approved custom model plan path is unavailable");
    modelPlanSha256 = writePrivateModelPlan(planPath, plan).sha256;
  }
  return serializeAssignments(state.decisions, {
    reviewVisited: state.reviewVisited,
    modelRevision: state.modelRevision,
    reviewedModelRevision: state.reviewedModelRevision,
    modelInspection: state.modelInspection,
    modelPlanSha256
  });
}

function clearChildren(container) {
  for (const child of container.getChildren()) {
    container.remove(child);
    child.destroy();
  }
}

export async function runOpenTuiInstaller({
  environment = process.env,
  stdin = process.stdin,
  stdout = process.stdout
} = {}) {
  let state = createInstallerState(environment);
  let renderer;
  let settled = false;
  let lastFrame = { lines: [], hitRegions: [] };
  let resolveSession;
  let rejectSession;
  const colorEnabled = !Object.hasOwn(environment, "NO_COLOR");

  const session = new Promise((resolvePromise, rejectPromise) => {
    resolveSession = resolvePromise;
    rejectSession = rejectPromise;
  });

  const finish = (error) => {
    if (settled) return;
    settled = true;
    if (error) rejectSession(error);
    else resolveSession();
  };

  const signalHandlers = new Map([
    ["SIGINT", () => {
      state = transition(state, { type: "CANCEL" });
      process.exitCode = 130;
      finish();
    }],
    ["SIGTERM", () => {
      state = transition(state, { type: "CANCEL" });
      process.exitCode = 143;
      finish();
    }],
    ["SIGHUP", () => {
      state = transition(state, { type: "CANCEL" });
      process.exitCode = 129;
      finish();
    }]
  ]);

  try {
    renderer = await createCliRenderer({
      stdin,
      stdout,
      exitOnCtrlC: false,
      exitSignals: [],
      screenMode: "alternate-screen",
      clearOnShutdown: true,
      useMouse: true,
      autoFocus: false,
      backgroundColor: colorEnabled ? THEME.background : undefined,
      consoleMode: "disabled"
    });

    const root = new BoxRenderable(renderer, {
      id: "alfred-installer",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      backgroundColor: colorEnabled ? THEME.background : undefined,
      shouldFill: true,
      onMouseScroll: (event) => {
        if (!overlayPaged(state)) return;
        const delta = event.scroll?.direction === "up" ? -1 : event.scroll?.direction === "down" ? 1 : 0;
        if (!delta) return;
        state = transition(state, { type: "PAGE", delta, pageSize: previewPageSize({ columns: renderer.width, rows: renderer.height }) });
        redraw();
      }
    });
    renderer.root.add(root);

    const dispatch = (action) => {
      if (!action || state.done) return;
      state = transition(state, action);
      if (state.done) finish();
      else redraw();
    };

    const redraw = () => {
      if (settled || state.done) return;
      const viewport = {
        columns: Math.max(0, renderer.width || renderer.terminalWidth || 80),
        rows: Math.max(0, renderer.height || renderer.terminalHeight || 24)
      };
      lastFrame = frameForState(state, viewport);
      state = lastFrame.state;
      clearChildren(root);
      lastFrame.lines.forEach((line, index) => {
        const y = index + 1;
        const tone = lineTone(line, index, lastFrame.lines.length);
        root.add(new TextRenderable(renderer, {
          id: `line-${index}`,
          content: line,
          width: "100%",
          height: 1,
          wrapMode: "none",
          fg: colorEnabled ? colorForTone(tone) : undefined,
          bg: colorEnabled ? THEME.background : undefined,
          selectable: false,
          onMouseDown: (event) => {
            if (event.button !== MouseButton.LEFT) return;
            const x = event.x + 1;
            const region = lastFrame.hitRegions.find((item) => x >= item.x1 && x <= item.x2 && y >= item.y1 && y <= item.y2);
            if (region) dispatch(region.action);
          }
        }));
      });
      renderer.requestRender();
    };

    renderer.keyInput.on("keypress", (key) => {
      try {
        dispatch(keyEventAction(key, state, { columns: renderer.width, rows: renderer.height }));
      } catch (error) {
        finish(error);
      }
    });
    renderer.on(CliRenderEvents.RESIZE, redraw);
    for (const [signal, handler] of signalHandlers) process.once(signal, handler);
    redraw();
    await session;
  } finally {
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    try {
      renderer?.destroy();
    } catch {}
  }

  if (state.cancelled) {
    if (!process.exitCode) process.exitCode = 130;
    return;
  }
  const output = assignmentsForState(state, environment);
  if (environment.ALFRED_INSTALL_APP_TUI_RESULT_FILE) {
    writeFileSync(environment.ALFRED_INSTALL_APP_TUI_RESULT_FILE, output, { mode: 0o600 });
  } else {
    stdout.write(output);
  }
}

function canonicalPath(value) {
  try {
    return realpathSync(value);
  } catch {
    return resolve(value);
  }
}

const isMain = import.meta.main === true ||
  Boolean(process.argv[1] && canonicalPath(process.argv[1]) === canonicalPath(fileURLToPath(import.meta.url)));

if (isMain) {
  try {
    await runOpenTuiInstaller();
  } catch (error) {
    process.stderr.write(`OpenTUI installer failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
