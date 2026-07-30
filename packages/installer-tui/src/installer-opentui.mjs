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
  HARNESSES,
  LABELS,
  PHASES,
  abbreviateHomePath,
  controlsFor,
  createPathfinderState,
  displayWidth,
  modelPlanForState,
  modelPlanInspectionStatus,
  modelPlanReviewLines,
  normalizeDiscovery,
  previewModel,
  rationaleLines,
  serializeAssignments,
  stripAnsi,
  textEditingActive,
  transition,
  validateCustomModelsDraft
} from "../../../scripts/tui/install-pathfinder.mjs";
import { writePrivateModelPlan } from "../../../scripts/tui/install-model-plan.mjs";

const THEME = Object.freeze({
  background: "#1f1f28",
  surface: "#252535",
  elevated: "#2a2a37",
  selection: "#2d4f67",
  border: "#54546d",
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
    if (overlayPaged(state)) return { type: "PAGE", delta: name === "up" ? -1 : 1, pageSize: openTuiPageMetrics(viewport).pageSize };
    if (!state.overlay || state.overlay.type === "model-editor") return { type: "MOVE", delta: name === "up" ? -1 : 1 };
    return null;
  }
  if (name === "left" || name === "right") {
    if (overlayPaged(state)) return { type: "PAGE", delta: name === "left" ? -1 : 1, pageSize: openTuiPageMetrics(viewport).pageSize };
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

function terminalSize(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : fallback;
}

export function responsiveLayout(viewport = { columns: 80, rows: 24 }) {
  const columns = terminalSize(viewport.columns, 80);
  const rows = terminalSize(viewport.rows, 24);
  const mode = columns >= 128 ? "wide" : columns >= 96 ? "medium" : "compact";
  return {
    mode,
    columns,
    rows,
    width: Math.min(columns, mode === "wide" ? 148 : mode === "medium" ? 112 : 80),
    height: Math.min(rows, rows >= 30 ? 34 : rows),
    headerHeight: mode === "compact" ? 4 : 5,
    footerHeight: 4
  };
}

function openTuiPageMetrics(viewportOrLayout) {
  const layout = viewportOrLayout?.mode ? viewportOrLayout : responsiveLayout(viewportOrLayout);
  return {
    pageSize: Math.max(1, layout.height - layout.headerHeight - layout.footerHeight - 6),
    contentWidth: Math.max(24, layout.width - (layout.mode === "wide" ? 64 : 8))
  };
}

function decisionChanged(state, key, normalize = (value) => value) {
  return JSON.stringify(normalize(state.decisions[key])) !==
    JSON.stringify(normalize(state.recommendation.decisions[key]));
}

function decisionTag(state, key, normalize) {
  return decisionChanged(state, key, normalize) ? "[chosen]" : "[suggested]";
}

function effectiveTarget(state) {
  const name = String(state.decisions.name || "").trim() || "acme";
  return String(state.decisions.targetPath || "").trim() || `~/.alfred/installs/${name}`;
}

function focusedControl(state) {
  const controls = controlsFor(state);
  if (!controls.length) return "";
  return controls[Math.max(0, Math.min(controls.length - 1, state.focus))];
}

function row(text, {
  tone = "foreground",
  control = "",
  action = null,
  focused = false,
  kind = "item"
} = {}) {
  return { text: stripAnsi(String(text)), tone, control, action, focused, kind };
}

function section(text) {
  return row(String(text).toUpperCase(), { tone: "muted", kind: "section" });
}

function actionRow(state, control, text, action, tone = "foreground") {
  return row(text, {
    tone,
    control,
    action,
    focused: focusedControl(state) === control,
    kind: "action"
  });
}

function modelsApplicable(state) {
  return state.decisions.edition !== "memory";
}

function memoryApplicable(state) {
  return state.decisions.edition !== "coding";
}

function profilesApplicable(state) {
  return state.decisions.edition !== "memory";
}

function reviewReady(state) {
  if (state.reviewedModelRevision !== state.modelRevision) return false;
  if (state.decisions.modelStrategy !== "custom-models") return true;
  return validateCustomModelsDraft(state.decisions.customModels).status === "pass" &&
    modelPlanInspectionStatus(state).complete &&
    state.decisions.modelWriteApproved === true;
}

function editingValue(state, control, value, placeholder) {
  if (state.editing?.control !== control) return value || placeholder;
  const characters = Array.from(state.editing.draft);
  characters.splice(state.editing.cursor, 0, "▏");
  return characters.join("") || "▏";
}

function discoverRows(state) {
  const discovery = state.discovery;
  const installedHarnesses = HARNESSES
    .filter(({ value }) => discovery.harnesses[value] === "installed")
    .map(({ label }) => label);
  const projectPath = abbreviateHomePath(discovery.git.project_root, discovery);
  const targetPath = abbreviateHomePath(discovery.install.selected_target, discovery);
  const modelSignal = discovery.models.suggestions.length
    ? discovery.models.suggestions.map(({ model }) => model).join(", ")
    : "No safe local signal";

  return [
    row("Alfred inspected this machine locally. Nothing has been changed.", { tone: "muted", kind: "description" }),
    section("Environment"),
    row(`${discovery.os.platform === "unknown" ? "○" : "✓"}  System        ${discovery.os.platform} ${discovery.os.release} · ${discovery.os.architecture}  [detected]`, {
      tone: discovery.os.platform === "unknown" ? "yellow" : "green"
    }),
    row(`${discovery.node.status === "ok" ? "✓" : "!"}  Node          ${discovery.node.version} · ${discovery.node.status}  [detected]`, {
      tone: discovery.node.status === "ok" ? "green" : "red"
    }),
    row(`${installedHarnesses.length ? "✓" : "○"}  Harnesses     ${installedHarnesses.length ? installedHarnesses.join(", ") : "None detected"}  [detected]`, {
      tone: installedHarnesses.length ? "green" : "foreground"
    }),
    row(`${discovery.models.suggestions.length ? "✓" : "○"}  Models        ${modelSignal}  [detected]`, {
      tone: discovery.models.suggestions.length ? "green" : "foreground"
    }),
    row(`${discovery.install.target_exists ? "✓" : "○"}  Installation  ${discovery.install.target_exists ? `Found at ${targetPath}` : "New installation"}  [detected]`, {
      tone: discovery.install.target_exists ? "green" : "foreground"
    }),
    row(`${discovery.git.repository_state === "repository" ? "✓" : "○"}  Project       ${projectPath}  [detected]`, {
      tone: discovery.git.repository_state === "repository" ? "green" : "foreground"
    }),
    section("Start"),
    actionRow(state, "recommended", "Use recommended setup                         [r]", { type: "USE_RECOMMENDED" }, "green"),
    actionRow(state, "customize", "Customize important choices", { type: "CUSTOMIZE" })
  ];
}

function chooseRows(state) {
  const decisions = state.decisions;
  const rows = [
    row("Choose the Alfred edition and where it should be available.", { tone: "muted", kind: "description" }),
    section("Edition"),
    actionRow(
      state,
      "edition",
      `Edition       ‹ ${LABELS.editions[decisions.edition]} ›  ${decisionTag(state, "edition")}`,
      { type: "CHANGE", delta: 1 },
      decisionChanged(state, "edition") ? "yellow" : "foreground"
    ),
    section("Harnesses")
  ];

  for (const harness of HARNESSES) {
    const selected = decisions.selectedHarnesses.includes(harness.value);
    const status = state.discovery.harnesses[harness.value];
    rows.push(actionRow(
      state,
      `harness:${harness.value}`,
      `${selected ? "[x]" : "[ ]"} ${harness.label.padEnd(12)}  [${LABELS.status[status]}]${selected ? "  [selected]" : ""}`,
      { type: "TOGGLE_HARNESS", value: harness.value },
      status === "installed" ? "green" : "muted"
    ));
  }

  if (profilesApplicable(state)) {
    rows.push(
      section("Runtime profile"),
      actionRow(
        state,
        "profile",
        `Profiles      ‹ ${LABELS.profiles[decisions.profileStrategy]} ›  ${decisionTag(state, "profileStrategy")}`,
        { type: "CHANGE", delta: 1 },
        decisionChanged(state, "profileStrategy") ? "yellow" : "foreground"
      )
    );
  }
  rows.push(
    section("Continue"),
    actionRow(state, "next", "Continue to configuration  →", { type: "NEXT" }, "blue")
  );
  return rows;
}

function modelSummaryRows(state) {
  const decisions = state.decisions;
  if (!modelsApplicable(state)) return [];
  if (decisions.modelStrategy === "smart-defaults") {
    const config = state.discovery.models.proposed_config;
    return [
      row(`    Global        ${config["*"]?.primary || "None detected"}`, { tone: "green", kind: "detail" }),
      row(`    Orchestrator  ${config.orchestrator?.primary || "Uses global"}`, { tone: "muted", kind: "detail" }),
      row(`    Developer     ${config.developer?.primary || "Uses global"}`, { tone: "muted", kind: "detail" }),
      row(`    Fallbacks     ${config.fallbacks?.join(" → ") || "None"}`, { tone: "muted", kind: "detail" })
    ];
  }
  if (decisions.modelStrategy === "custom-models") {
    return [
      row(`    Global        ${decisions.customModels.wildcard || "Required"}`, { tone: decisions.customModels.wildcard ? "green" : "red", kind: "detail" }),
      row(`    Orchestrator  ${decisions.customModels.orchestrator || "Uses global"}`, { tone: "muted", kind: "detail" }),
      row(`    Developer     ${decisions.customModels.developer || "Uses global"}`, { tone: "muted", kind: "detail" }),
      actionRow(state, "models-edit", "Edit exact model assignments  →", { type: "OPEN_MODEL_EDITOR" }, "blue")
    ];
  }
  return [
    row(decisions.modelStrategy === "keep-existing"
      ? "    Existing model configuration remains untouched."
      : "    No model configuration will be written.", { tone: "muted", kind: "detail" })
  ];
}

function configureRows(state) {
  const decisions = state.decisions;
  const rows = [
    row("Configure only the decisions that affect this installation.", { tone: "muted", kind: "description" })
  ];
  if (memoryApplicable(state)) {
    rows.push(
      section("Memory"),
      actionRow(
        state,
        "memory",
        `Storage       ‹ ${LABELS.memory[decisions.memorySetup]} ›  ${decisionTag(state, "memorySetup")}`,
        { type: "CHANGE", delta: 1 },
        decisionChanged(state, "memorySetup") ? "yellow" : "foreground"
      )
    );
  }
  if (modelsApplicable(state)) {
    rows.push(
      section("Models"),
      actionRow(
        state,
        "models",
        `Strategy      ‹ ${LABELS.models[decisions.modelStrategy]} ›  ${decisionTag(state, "modelStrategy")}`,
        { type: "CHANGE", delta: 1 },
        decisionChanged(state, "modelStrategy") ? "yellow" : "foreground"
      ),
      ...modelSummaryRows(state)
    );
  }
  rows.push(
    section("Install target"),
    actionRow(
      state,
      "name",
      `Name          [ ${editingValue(state, "name", decisions.name, "acme")} ]`,
      { type: "FOCUS_CONTROL", control: "name" }
    ),
    actionRow(
      state,
      "path",
      `Path          [ ${editingValue(state, "path", decisions.targetPath, `~/.alfred/installs/${decisions.name || "acme"}`)} ]`,
      { type: "FOCUS_CONTROL", control: "path" }
    ),
    section("Execution"),
    actionRow(
      state,
      "intent",
      `Intent        ‹ ${LABELS.intents[decisions.applyIntent]} ›  ${decisionTag(state, "applyIntent")}`,
      { type: "CHANGE", delta: 1 },
      decisions.applyIntent === "apply-safe-steps" ? "yellow" : "green"
    ),
    actionRow(state, "next", "Review complete installation  →", { type: "NEXT" }, "blue")
  );
  return rows;
}

function reviewRows(state) {
  const decisions = state.decisions;
  const ready = reviewReady(state);
  const rows = [
    row("Review is mandatory. Apply remains locked until you explicitly continue.", { tone: "muted", kind: "description" }),
    section("Validation"),
    row("✓  Configuration is internally consistent", { tone: "green" }),
    row("✓  Protected paths remain deny-by-default", { tone: "green" }),
    row("✓  Provider calls: 0", { tone: "green" })
  ];

  if (decisions.modelStrategy === "custom-models") {
    const inspection = modelPlanInspectionStatus(state);
    rows.push(actionRow(
      state,
      "model-plan-review",
      `${inspection.complete ? "✓" : "!"}  Inspect exact models.json       [${inspection.label}]`,
      { type: "OPEN_MODEL_PLAN_REVIEW" },
      inspection.complete ? "green" : "red"
    ));
  }
  if (modelsApplicable(state) && ["smart-defaults", "custom-models"].includes(decisions.modelStrategy)) {
    rows.push(actionRow(
      state,
      "model-approval",
      `[${decisions.modelWriteApproved ? "x" : " "}] Approve models.json write`,
      { type: "PATCH", key: "modelWriteApproved", value: !decisions.modelWriteApproved },
      decisions.modelWriteApproved ? "green" : "yellow"
    ));
  }
  rows.push(
    section("Decision"),
    actionRow(
      state,
      "continue",
      ready ? "Continue to explicit confirmation  →" : "Continue blocked — complete required review",
      { type: "CONTINUE" },
      ready ? "blue" : "red"
    ),
    actionRow(state, "edit", "Edit configuration", { type: "EDIT" })
  );
  return rows;
}

function applyRows(state) {
  const ready = reviewReady(state) && state.reviewVisited;
  const apply = state.decisions.applyIntent === "apply-safe-steps";
  const rows = [
    row(apply
      ? "Alfred is ready to apply the approved safe steps."
      : "Alfred will return this plan without writing installation files.", {
      tone: apply ? "yellow" : "green",
      kind: "description"
    }),
    section("Human approval"),
    row(`${apply ? "!" : "✓"}  Execution       ${LABELS.intents[state.decisions.applyIntent]}`, {
      tone: apply ? "yellow" : "green"
    }),
    row(`${state.decisions.modelWriteApproved ? "!" : "✓"}  Models write     ${state.decisions.modelWriteApproved ? "Approved" : "Not approved"}`, {
      tone: state.decisions.modelWriteApproved ? "yellow" : "green"
    })
  ];
  if (modelsApplicable(state) && ["smart-defaults", "custom-models"].includes(state.decisions.modelStrategy)) {
    rows.push(actionRow(
      state,
      "model-approval",
      `[${state.decisions.modelWriteApproved ? "x" : " "}] Approve models.json write`,
      { type: "PATCH", key: "modelWriteApproved", value: !state.decisions.modelWriteApproved },
      state.decisions.modelWriteApproved ? "green" : "yellow"
    ));
  }
  rows.push(
    section("Final decision"),
    actionRow(
      state,
      "confirm",
      ready ? `Confirm ${LABELS.intents[state.decisions.applyIntent]}  ↵` : "Confirmation blocked by Review",
      { type: "CONFIRM" },
      ready ? (apply ? "yellow" : "green") : "red"
    ),
    actionRow(state, "back", "Back to Review", { type: "BACK" })
  );
  return rows;
}

function modelEditorRows(state) {
  const models = state.decisions.customModels;
  const validation = validateCustomModelsDraft(models);
  const rows = [
    row("Opaque model IDs are preserved exactly. No provider calls are made.", { tone: "muted", kind: "description" }),
    ...validation.errors.map((error) => row(`! ${error}`, { tone: "red" })),
    section("Primary assignments"),
    actionRow(
      state,
      "model:wildcard",
      `Global *      [ ${editingValue(state, "model:wildcard", models.wildcard, "required")} ]${state.editing?.control === "model:wildcard" ? "  [editing]" : ""}`,
      { type: "FOCUS_CONTROL", control: "model:wildcard" },
      models.wildcard ? "foreground" : "red"
    ),
    actionRow(
      state,
      "model:orchestrator",
      `Orchestrator  [ ${editingValue(state, "model:orchestrator", models.orchestrator, "uses global")} ]${state.editing?.control === "model:orchestrator" ? "  [editing]" : ""}`,
      { type: "FOCUS_CONTROL", control: "model:orchestrator" }
    ),
    actionRow(
      state,
      "model:developer",
      `Developer     [ ${editingValue(state, "model:developer", models.developer, "uses global")} ]${state.editing?.control === "model:developer" ? "  [editing]" : ""}`,
      { type: "FOCUS_CONTROL", control: "model:developer" }
    ),
    section("Global fallbacks")
  ];
  models.fallbacks.forEach((value, index) => {
    const control = `model:fallback:${index}`;
    rows.push(actionRow(
      state,
      control,
      `${index + 1}. [ ${editingValue(state, control, value, "empty")} ]${state.editing?.control === control ? "  [editing]" : ""}`,
      { type: "FOCUS_CONTROL", control },
      value ? "foreground" : "red"
    ));
  });
  rows.push(
    actionRow(state, "fallback-add", "+ Add fallback", { type: "FOCUS_CONTROL", control: "fallback-add" }),
    actionRow(state, "fallback-remove", "− Remove selected fallback", { type: "FOCUS_CONTROL", control: "fallback-remove" }),
    actionRow(state, "fallback-up", "↑ Move fallback up", { type: "FOCUS_CONTROL", control: "fallback-up" }),
    actionRow(state, "fallback-down", "↓ Move fallback down", { type: "FOCUS_CONTROL", control: "fallback-down" }),
    actionRow(state, "model-editor-done", "Done editing models  →", { type: "FOCUS_CONTROL", control: "model-editor-done" }, "blue")
  );
  return rows;
}

function overlayRows(state, layout) {
  const { pageSize, contentWidth } = openTuiPageMetrics(layout);
  if (state.overlay.type === "model-editor") return modelEditorRows(state);
  let source;
  let title;
  if (state.overlay.type === "why") {
    source = rationaleLines(state).slice(1);
    title = "Why these defaults";
  } else if (state.overlay.type === "model-plan-review") {
    source = modelPlanReviewLines(state, contentWidth);
    title = "Exact models.json";
  } else {
    source = previewModel(state.decisions, state.discovery).lines.slice(1);
    title = "Full installation preview";
  }
  const pageCount = Math.max(1, Math.ceil(source.length / pageSize));
  const page = Math.max(0, Math.min(pageCount - 1, state.overlay.page || 0));
  return {
    title,
    subtitle: `${state.overlay.type === "why" ? "Local reasoning only" : "Read-only"} · page ${page + 1}/${pageCount}`,
    rows: source.slice(page * pageSize, (page + 1) * pageSize).map((text) => row(text, {
      tone: /provider calls:\s*0|safety:/i.test(text) ? "green" : /blocker|blocked|not inspected/i.test(text) ? "red" : "foreground"
    }))
  };
}

function phaseSurface(state, layout) {
  if (state.overlay) {
    const overlay = overlayRows(state, layout);
    if (Array.isArray(overlay)) {
      return { title: "Edit model assignments", subtitle: "Enter edits · Esc closes", rows: overlay };
    }
    return overlay;
  }
  if (state.phase === "Discover") return {
    title: "Welcome to Alfred",
    subtitle: "A local-first runtime for operating AI agents",
    rows: discoverRows(state)
  };
  if (state.phase === "Choose") return {
    title: "Choose your setup",
    subtitle: "Detected values and recommendations remain visible",
    rows: chooseRows(state)
  };
  if (state.phase === "Configure") return {
    title: "Configure installation",
    subtitle: "Only consequential decisions require your input",
    rows: configureRows(state)
  };
  if (state.phase === "Review") return {
    title: "Review before writing",
    subtitle: "Nothing has been written yet",
    rows: reviewRows(state)
  };
  return {
    title: "Explicit confirmation",
    subtitle: "This is the final authority boundary",
    rows: applyRows(state)
  };
}

function previewRows(state) {
  const selectedHarnesses = state.decisions.selectedHarnesses
    .map((id) => HARNESSES.find(({ value }) => value === id)?.label || id);
  const rows = [
    row(`Edition     ${LABELS.editions[state.decisions.edition]}`, { tone: decisionChanged(state, "edition") ? "yellow" : "foreground" }),
    row(`Harnesses   ${selectedHarnesses.length ? selectedHarnesses.join(", ") : "None"}`),
    ...(profilesApplicable(state) ? [row(`Profiles    ${LABELS.profiles[state.decisions.profileStrategy]}`)] : []),
    ...(memoryApplicable(state) ? [row(`Memory      ${LABELS.memory[state.decisions.memorySetup]}`)] : []),
    ...(modelsApplicable(state) ? [row(`Models      ${LABELS.models[state.decisions.modelStrategy]}`)] : []),
    row(`Target      ${abbreviateHomePath(effectiveTarget(state), state.discovery)}`),
    row(`Intent      ${LABELS.intents[state.decisions.applyIntent]}`, {
      tone: state.decisions.applyIntent === "preview-only" ? "green" : "yellow"
    }),
    section("Safety"),
    row("✓ Preview-first", { tone: "green" }),
    row("✓ Provider calls: 0", { tone: "green" }),
    row("✓ Human approval required", { tone: "green" })
  ];
  return rows;
}

function navigationSteps(state) {
  const activeIndex = Math.max(0, PHASES.indexOf(state.phase));
  return PHASES.map((phase, index) => ({
    phase,
    marker: index < activeIndex ? "✓" : index === activeIndex ? "●" : "○",
    tone: index < activeIndex ? "green" : index === activeIndex ? "blue" : "muted",
    active: index === activeIndex,
    status: index < activeIndex ? "complete" : index === activeIndex ? "current" : "pending"
  }));
}

function footerLines(state, layout) {
  const preview = previewModel(state.decisions, state.discovery).concise;
  const keys = state.editing
    ? "←→ cursor  Enter save  Esc cancel  Backspace/Delete edit"
    : state.overlay
      ? "Esc close  ←→/↑↓ pages  p preview  w why  q cancel"
      : layout.mode === "compact"
        ? "↑↓ Move · ←→ Change · Space Toggle · Enter Select · b Back · p Preview · q Quit"
        : "↑↓ move  ←→ change  Space toggle  Enter select  b back  p preview  w why  q quit";
  return [
    layout.mode === "wide"
      ? "Safety · Preview-first · human approval required · provider calls 0"
      : `Preview · ${preview}`,
    keys
  ];
}

function normalizePagedState(state, layout) {
  const { pageSize, contentWidth } = openTuiPageMetrics(layout);
  if (state.overlay?.type === "preview") {
    return transition(state, { type: "PAGE", delta: 0, pageSize });
  }
  if (state.overlay?.type === "model-plan-review") {
    const totalItems = modelPlanReviewLines(state, contentWidth).length;
    return transition(state, {
      type: "PAGE",
      delta: 0,
      pageSize,
      totalItems,
      inspectionKey: `${contentWidth}:${totalItems}`
    });
  }
  return state;
}

export function openTuiViewForState(state, viewport = { columns: 80, rows: 24 }) {
  const layout = responsiveLayout(viewport);
  const normalized = normalizePagedState(state, layout);
  return {
    state: normalized,
    layout,
    title: "ALFRED INSTALLER",
    tagline: "Local-first agent runtime",
    modeLabel: normalized.decisions.applyIntent === "apply-safe-steps" ? "APPLY REQUESTED" : "PREVIEW MODE",
    steps: navigationSteps(normalized),
    main: phaseSurface(normalized, layout),
    preview: {
      title: "LIVE PREVIEW",
      rows: previewRows(normalized),
      concise: previewModel(normalized.decisions, normalized.discovery).concise
    },
    footer: footerLines(normalized, layout),
    provider_calls: 0
  };
}

function clipText(text, width) {
  const value = stripAnsi(String(text));
  if (displayWidth(value) <= width) return value;
  if (width <= 1) return width === 1 ? "…" : "";
  let output = "";
  for (const character of Array.from(value)) {
    if (displayWidth(`${output}${character}…`) > width) break;
    output += character;
  }
  return `${output}…`;
}

function padText(text, width) {
  const clipped = clipText(text, width);
  return `${clipped}${" ".repeat(Math.max(0, width - displayWidth(clipped)))}`;
}

function framedLines(title, rows, width, height) {
  const inner = Math.max(1, width - 2);
  const label = clipText(` ${title} `, inner);
  const result = [`┌${label}${"─".repeat(Math.max(0, inner - displayWidth(label)))}┐`];
  const fitted = fitRows(rows, Math.max(0, height - 2));
  fitted.forEach((entry) => result.push(`│${padText(`${entry.focused ? "› " : "  "}${entry.text}`, inner)}│`));
  while (result.length < height - 1) result.push(`│${" ".repeat(inner)}│`);
  result.push(`└${"─".repeat(inner)}┘`);
  return result.slice(0, height);
}

function fitRows(rows, available) {
  if (available <= 0) return [];
  if (rows.length <= available) return rows;
  const focused = rows.findIndex((entry) => entry.focused);
  const anchor = focused >= 0 ? focused : 0;
  let start = Math.max(0, anchor - Math.floor(available / 2));
  start = Math.min(start, Math.max(0, rows.length - available));
  const visible = rows.slice(start, start + available);
  if (start > 0) visible[0] = row("… more above", { tone: "muted" });
  if (start + available < rows.length) visible[visible.length - 1] = row("… more below", { tone: "muted" });
  return visible;
}

export function frameForState(state, viewport = { columns: 80, rows: 24 }) {
  const view = openTuiViewForState(state, viewport);
  const { layout } = view;
  if (layout.width < 20 || layout.height < 8) {
    return {
      state: view.state,
      lines: ["Resize terminal", "q cancel"].slice(0, layout.height),
      hitRegions: [],
      provider_calls: 0
    };
  }
  const bodyHeight = Math.max(4, layout.height - layout.headerHeight - layout.footerHeight);
  const header = [
    `${view.title}  ·  ${view.tagline}`,
    `${view.steps.map(({ phase, marker }) => `${marker} ${phase}`).join("  ")}  ·  [${view.modeLabel}]  ·  PROVIDERS 0`
  ];
  let body;
  if (layout.mode === "wide") {
    const gap = 1;
    const navWidth = 22;
    const previewWidth = 36;
    const mainWidth = layout.width - navWidth - previewWidth - gap * 2;
    const navRows = view.steps.map(({ phase, marker, status, tone }) => row(`${marker} ${phase}  ${status}`, { tone }));
    const columns = [
      framedLines("INSTALL", navRows, navWidth, bodyHeight),
      framedLines(view.main.title, view.main.rows, mainWidth, bodyHeight),
      framedLines(view.preview.title, view.preview.rows, previewWidth, bodyHeight)
    ];
    body = Array.from({ length: bodyHeight }, (_, index) =>
      `${padText(columns[0][index] || "", navWidth)} ${padText(columns[1][index] || "", mainWidth)} ${columns[2][index] || ""}`
    );
  } else if (layout.mode === "medium") {
    const navWidth = 22;
    const mainWidth = layout.width - navWidth - 1;
    const navRows = view.steps.map(({ phase, marker, status, tone }) => row(`${marker} ${phase}  ${status}`, { tone }));
    const nav = framedLines("INSTALL", navRows, navWidth, bodyHeight);
    const main = framedLines(view.main.title, view.main.rows, mainWidth, bodyHeight);
    body = Array.from({ length: bodyHeight }, (_, index) =>
      `${padText(nav[index] || "", navWidth)} ${main[index] || ""}`
    );
  } else {
    body = framedLines(view.main.title, view.main.rows, layout.width, bodyHeight);
  }
  const lines = [
    ...header,
    ...body,
    ...view.footer.map((line) => clipText(line, layout.width))
  ].slice(0, layout.height);
  const hitRegions = [];
  let actionY = layout.headerHeight;
  for (const entry of fitRows(view.main.rows, Math.max(0, bodyHeight - 2))) {
    if (entry.action) hitRegions.push({ x1: 1, x2: layout.width, y1: actionY, y2: actionY, action: entry.action });
    actionY += 1;
  }
  return {
    state: view.state,
    lines,
    hitRegions,
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

function addText(renderer, parent, {
  id,
  content,
  tone = "foreground",
  background,
  height = 1,
  width = "100%",
  marginLeft = 0,
  onMouseDown
}, colorEnabled) {
  const text = new TextRenderable(renderer, {
    id,
    content,
    width,
    height,
    marginLeft,
    wrapMode: "none",
    fg: colorEnabled ? colorForTone(tone) : undefined,
    bg: colorEnabled ? background : undefined,
    selectable: false,
    onMouseDown
  });
  parent.add(text);
  return text;
}

function addRows(renderer, parent, rows, {
  idPrefix,
  available,
  dispatch,
  colorEnabled
}) {
  fitRows(rows, available).forEach((entry, index) => {
    const pointer = entry.focused ? "›" : entry.kind === "section" ? "─" : " ";
    const content = `${pointer} ${entry.text}`;
    addText(renderer, parent, {
      id: `${idPrefix}-${index}`,
      content,
      tone: entry.focused ? "blue" : entry.tone,
      background: entry.focused ? THEME.selection : undefined,
      onMouseDown: entry.action ? (event) => {
        if (event.button !== MouseButton.LEFT) return;
        if (entry.focused && entry.action.type === "FOCUS_CONTROL") dispatch({ type: "ACTIVATE" });
        else dispatch(entry.action);
      } : undefined
    }, colorEnabled);
  });
}

function addPanel(renderer, parent, {
  id,
  title,
  subtitle = "",
  rows,
  width,
  height,
  flexGrow,
  dispatch,
  colorEnabled,
  active = false
}) {
  const panel = new BoxRenderable(renderer, {
    id,
    ...(width === undefined ? {} : { width }),
    height,
    ...(flexGrow === undefined ? {} : { flexGrow }),
    flexDirection: "column",
    border: true,
    borderStyle: "single",
    borderColor: colorEnabled ? (active ? THEME.blue : THEME.border) : undefined,
    title,
    titleColor: colorEnabled ? (active ? THEME.blue : THEME.foreground) : undefined,
    backgroundColor: colorEnabled ? THEME.surface : undefined,
    paddingX: 1,
    shouldFill: true,
    overflow: "hidden"
  });
  parent.add(panel);
  if (subtitle) {
    addText(renderer, panel, {
      id: `${id}-subtitle`,
      content: subtitle,
      tone: "muted"
    }, colorEnabled);
  }
  const contentHeight = Math.max(0, height - 2 - (subtitle ? 1 : 0));
  addRows(renderer, panel, rows, {
    idPrefix: `${id}-row`,
    available: contentHeight,
    dispatch,
    colorEnabled
  });
  return panel;
}

function renderOpenTuiView(renderer, root, view, dispatch, colorEnabled) {
  const { layout } = view;
  clearChildren(root);
  if (layout.width < 20 || layout.height < 8) {
    const resize = new BoxRenderable(renderer, {
      id: "resize-terminal",
      width: Math.max(1, layout.width),
      height: Math.max(1, layout.height),
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colorEnabled ? THEME.background : undefined
    });
    root.add(resize);
    addText(renderer, resize, {
      id: "resize-message",
      content: "Resize terminal · q cancel",
      tone: "yellow",
      width: "auto"
    }, colorEnabled);
    return;
  }

  const shell = new BoxRenderable(renderer, {
    id: "installer-shell",
    width: layout.width,
    height: layout.height,
    flexDirection: "column",
    rowGap: 0,
    backgroundColor: colorEnabled ? THEME.background : undefined,
    shouldFill: true
  });
  root.add(shell);

  const stepLine = view.steps
    .map(({ phase, marker, active }) => `${marker} ${active ? phase.toUpperCase() : phase}`)
    .join("   ");
  const header = new BoxRenderable(renderer, {
    id: "installer-header",
    width: "100%",
    height: layout.headerHeight,
    flexDirection: "column",
    border: true,
    borderStyle: "single",
    borderColor: colorEnabled ? THEME.blue : undefined,
    title: `${view.title} · ${view.tagline}`,
    titleColor: colorEnabled ? THEME.blue : undefined,
    bottomTitle: `[${view.modeLabel}] · PROVIDERS 0`,
    bottomTitleAlignment: "right",
    backgroundColor: colorEnabled ? THEME.background : undefined,
    paddingX: 1,
    shouldFill: true
  });
  shell.add(header);
  addText(renderer, header, {
    id: "step-progress",
    content: stepLine,
    tone: "blue"
  }, colorEnabled);
  if (layout.headerHeight >= 5) {
    addText(renderer, header, {
      id: "safety-line",
      content: "Preview-first · deny-by-default · no provider calls during detection",
      tone: "muted"
    }, colorEnabled);
  }

  const bodyHeight = Math.max(1, layout.height - layout.headerHeight - layout.footerHeight);
  const body = new BoxRenderable(renderer, {
    id: "installer-body",
    width: "100%",
    height: bodyHeight,
    flexDirection: "row",
    columnGap: 1,
    backgroundColor: colorEnabled ? THEME.background : undefined,
    shouldFill: true
  });
  shell.add(body);

  if (layout.mode !== "compact") {
    const navRows = view.steps.map(({ phase, marker, tone, active }) =>
      row(`${marker} ${phase}`, { tone, focused: active })
    );
    addPanel(renderer, body, {
      id: "navigation-panel",
      title: "INSTALL",
      rows: navRows,
      width: 23,
      height: bodyHeight,
      dispatch,
      colorEnabled
    });
  }

  addPanel(renderer, body, {
    id: "decision-panel",
    title: view.main.title,
    subtitle: view.main.subtitle,
    rows: view.main.rows,
    height: bodyHeight,
    flexGrow: 1,
    dispatch,
    colorEnabled,
    active: true
  });

  if (layout.mode === "wide") {
    addPanel(renderer, body, {
      id: "preview-panel",
      title: view.preview.title,
      subtitle: "Updates as you decide",
      rows: view.preview.rows,
      width: 37,
      height: bodyHeight,
      dispatch,
      colorEnabled
    });
  }

  const footer = new BoxRenderable(renderer, {
    id: "installer-footer",
    width: "100%",
    height: layout.footerHeight,
    flexDirection: "column",
    border: true,
    borderStyle: "single",
    borderColor: colorEnabled ? THEME.border : undefined,
    title: "KEYBOARD",
    titleColor: colorEnabled ? THEME.muted : undefined,
    backgroundColor: colorEnabled ? THEME.background : undefined,
    paddingX: 1,
    shouldFill: true
  });
  shell.add(footer);
  view.footer.forEach((content, index) => addText(renderer, footer, {
    id: `footer-${index}`,
    content,
    tone: index === 0 ? "green" : "muted"
  }, colorEnabled));
}

export async function runOpenTuiInstaller({
  environment = process.env,
  stdin = process.stdin,
  stdout = process.stdout
} = {}) {
  let state = createInstallerState(environment);
  let renderer;
  let settled = false;
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
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colorEnabled ? THEME.background : undefined,
      shouldFill: true,
      onMouseScroll: (event) => {
        if (!overlayPaged(state)) return;
        const delta = event.scroll?.direction === "up" ? -1 : event.scroll?.direction === "down" ? 1 : 0;
        if (!delta) return;
        state = transition(state, {
          type: "PAGE",
          delta,
          pageSize: openTuiPageMetrics({ columns: renderer.width, rows: renderer.height }).pageSize
        });
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
      const view = openTuiViewForState(state, viewport);
      state = view.state;
      renderOpenTuiView(renderer, root, view, dispatch, colorEnabled);
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
