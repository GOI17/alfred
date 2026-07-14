export const PHASES = ["Discover", "Choose", "Configure", "Review", "Apply"];

export const EDITIONS = [
  { value: "coding", label: "Coding" },
  { value: "memory", label: "Memory" },
  { value: "full", label: "Full" }
];

export const HARNESSES = [
  { value: "opencode", label: "opencode" },
  { value: "codex-cli", label: "Codex CLI" },
  { value: "codex-app", label: "Codex App" },
  { value: "pi", label: "Pi" }
];

export const MEMORY_SETUPS = [
  { value: "decide-later", label: "Decide later" },
  { value: "local-sqlite", label: "Local SQLite" },
  { value: "postgres", label: "Postgres" }
];

const PROFILE_STRATEGIES = ["runtime-profiles", "decide-later"];
const APPLY_INTENTS = ["preview-only", "apply-safe-steps"];
const MODEL_GUIDANCE = "Models: per-agent primary overrides plus one global fallback chain; no model IDs are selected.";
const PREVIEW_PAGE_SIZE = 8;

export function previewPageSize({ columns = 80, rows = 24 } = {}) {
  const width = Math.max(20, Number(columns) || 80);
  const height = Math.max(8, Number(rows) || 24);
  return width >= 100 ? Math.max(1, height - 6) : Math.max(1, Math.min(PREVIEW_PAGE_SIZE, height - 6));
}

function asStatusMap(status) {
  if (status instanceof Map) return new Map(status);
  if (typeof status === "string") {
    return new Map(status.split(",").map((entry) => entry.split("=")).filter(([key, value]) => key && value));
  }
  return new Map(Object.entries(status || {}));
}

export function parseHarnessSelection(value, status = new Map()) {
  const raw = Array.isArray(value) ? value : String(value ?? "auto").split(/[,+| ]+/).filter(Boolean);
  const selected = [];
  const add = (id) => {
    if (HARNESSES.some((item) => item.value === id) && !selected.includes(id)) selected.push(id);
  };
  for (const id of raw) {
    if (id === "auto") HARNESSES.filter((item) => status.get(item.value) === "installed").forEach((item) => add(item.value));
    else if (id === "codex") {
      add("codex-cli");
      add("codex-app");
    } else if (id !== "none" && id !== "decide-later") add(id);
  }
  return selected;
}

export function recommend({ current = {}, harnessStatus = {} } = {}) {
  const status = asStatusMap(harnessStatus);
  const edition = EDITIONS.some((item) => item.value === current.edition) ? current.edition : "coding";
  const harnessSeed = current.harnesses ?? current.selectedHarnesses ?? current.harness ?? "auto";
  const harnessTokens = Array.isArray(harnessSeed) ? harnessSeed : String(harnessSeed).split(/[,+| ]+/).filter(Boolean);
  const validHarnessTokens = new Set(["auto", "none", "decide-later", "codex", ...HARNESSES.map((item) => item.value)]);
  const validHarnessSeed = Array.isArray(harnessSeed)
    ? harnessTokens.every((value) => validHarnessTokens.has(value))
    : harnessTokens.length > 0 && harnessTokens.every((value) => validHarnessTokens.has(value));
  const normalizedHarnessSeed = validHarnessSeed ? harnessSeed : "auto";
  const explicitHarness = validHarnessSeed && (Array.isArray(harnessSeed) || !harnessTokens.includes("auto"));
  const selectedHarnesses = parseHarnessSelection(normalizedHarnessSeed, status);
  const profileSeed = current.profileStrategy ?? current.profile;
  const memorySeed = current.memorySetup ?? current.memory;
  const profileStrategy = edition === "memory"
    ? "not-needed-for-memory-edition"
    : PROFILE_STRATEGIES.includes(profileSeed) ? profileSeed : "runtime-profiles";
  const memorySetup = edition === "coding"
    ? "not-needed-for-coding-edition"
    : MEMORY_SETUPS.some((item) => item.value === memorySeed) ? memorySeed : "decide-later";
  const decisions = {
    edition,
    selectedHarnesses,
    profileStrategy,
    memorySetup,
    name: String(current.name || "acme"),
    targetPath: String(current.targetPath ?? current.path ?? ""),
    applyIntent: "preview-only",
    apply: false
  };
  const reasons = [
    EDITIONS.some((item) => item.value === current.edition) ? "edition-current-value" : "edition-coding-default",
    explicitHarness ? "harness-explicit-selection" : selectedHarnesses.length ? "harness-installed-auto" : "harness-none-installed",
    edition === "memory" ? "profiles-not-needed" : profileSeed === "decide-later" ? "profiles-current-value" : "profiles-runtime-default",
    edition === "coding" ? "memory-not-needed" : MEMORY_SETUPS.some((item) => item.value === memorySeed) ? "memory-current-value" : "memory-decide-later-default",
    "execution-preview-default",
    "models-user-owned"
  ];
  return {
    decisions,
    reasons,
    harnessStatus: Object.fromEntries(status),
    providerCalls: 0,
    provider_calls: 0,
    traceEvent: {
      event: "installer_recommendation_computed",
      data: { reasons: [...reasons], provider_calls: 0 }
    }
  };
}

export function createPathfinderState(input = {}) {
  const recommendation = recommend(input);
  return {
    phase: "Discover",
    decisions: { ...recommendation.decisions, selectedHarnesses: [...recommendation.decisions.selectedHarnesses] },
    recommendation,
    focus: 0,
    overlay: null,
    history: [],
    done: false,
    cancelled: false,
    reviewVisited: false,
    providerCalls: 0,
    provider_calls: 0
  };
}

function controls(state) {
  if (state.phase === "Discover") return ["recommended", "customize"];
  if (state.phase === "Choose") return ["edition", ...HARNESSES.map((item) => `harness:${item.value}`), "profile", "next"];
  if (state.phase === "Configure") return ["memory", "name", "path", "intent", "next"];
  if (state.phase === "Review") return ["continue", "edit"];
  return ["confirm", "back"];
}

function boundedFocus(state, focus = state.focus) {
  return Math.max(0, Math.min(controls(state).length - 1, focus));
}

function go(state, phase) {
  return { ...state, phase, focus: 0, history: [...state.history, state.phase] };
}

function back(state) {
  if (!state.history.length) return state;
  const history = [...state.history];
  return { ...state, phase: history.pop(), history, focus: 0 };
}

function cycle(values, value, delta) {
  const index = Math.max(0, values.indexOf(value));
  return values[(index + delta + values.length) % values.length];
}

function withEdition(decisions, edition) {
  const next = { ...decisions, edition };
  if (edition === "memory") next.profileStrategy = "not-needed-for-memory-edition";
  else if (next.profileStrategy === "not-needed-for-memory-edition") next.profileStrategy = "runtime-profiles";
  if (edition === "coding") next.memorySetup = "not-needed-for-coding-edition";
  else if (next.memorySetup === "not-needed-for-coding-edition") next.memorySetup = "decide-later";
  return next;
}

function patchDecision(state, key, value) {
  let decisions = { ...state.decisions, selectedHarnesses: [...state.decisions.selectedHarnesses] };
  if (key === "edition" && EDITIONS.some((item) => item.value === value)) decisions = withEdition(decisions, value);
  if ((key === "harness" || key === "harnesses") && value !== undefined) decisions.selectedHarnesses = parseHarnessSelection(value, asStatusMap({}));
  if ((key === "profiles" || key === "profileStrategy") && PROFILE_STRATEGIES.includes(value)) decisions.profileStrategy = value;
  if ((key === "memory" || key === "memorySetup") && MEMORY_SETUPS.some((item) => item.value === value)) decisions.memorySetup = value;
  if (key === "name") decisions.name = String(value);
  if (key === "path" || key === "targetPath") decisions.targetPath = String(value);
  if (key === "apply") {
    decisions.apply = value === true || value === "true" || value === "yes";
    decisions.applyIntent = decisions.apply ? "apply-safe-steps" : "preview-only";
  }
  if (key === "applyIntent" && APPLY_INTENTS.includes(value)) {
    decisions.applyIntent = value;
    decisions.apply = false;
  }
  return { ...state, decisions, providerCalls: 0, provider_calls: 0 };
}

function toggleHarness(state, id) {
  const selected = state.decisions.selectedHarnesses.includes(id)
    ? state.decisions.selectedHarnesses.filter((value) => value !== id)
    : [...state.decisions.selectedHarnesses, id];
  return { ...state, decisions: { ...state.decisions, selectedHarnesses: selected } };
}

function change(state, delta) {
  const control = controls(state)[boundedFocus(state)];
  if (control === "edition") return { ...state, decisions: withEdition(state.decisions, cycle(EDITIONS.map((item) => item.value), state.decisions.edition, delta)) };
  if (control.startsWith("harness:")) return toggleHarness(state, control.slice(8));
  if (control === "profile" && state.decisions.edition !== "memory") return patchDecision(state, "profileStrategy", cycle(PROFILE_STRATEGIES, state.decisions.profileStrategy, delta));
  if (control === "memory" && state.decisions.edition !== "coding") return patchDecision(state, "memorySetup", cycle(MEMORY_SETUPS.map((item) => item.value), state.decisions.memorySetup, delta));
  if (control === "intent") return patchDecision(state, "applyIntent", cycle(APPLY_INTENTS, state.decisions.applyIntent, delta));
  return state;
}

function activate(state) {
  const control = controls(state)[boundedFocus(state)];
  if (control === "recommended") return transition(state, { type: "USE_RECOMMENDED" });
  if (control === "customize") return transition(state, { type: "CUSTOMIZE" });
  if (control?.startsWith("harness:")) return toggleHarness(state, control.slice(8));
  if (control === "profile" || control === "memory" || control === "intent") return change(state, 1);
  if (control === "next") return transition(state, { type: "NEXT" });
  if (control === "continue") return transition(state, { type: "CONTINUE" });
  if (control === "edit") return go(state, "Configure");
  if (control === "confirm") return transition(state, { type: "CONFIRM" });
  if (control === "back") return back(state);
  if (control === "name" || control === "path") return { ...state, focus: boundedFocus(state, state.focus + 1) };
  return state;
}

export function transition(state, action = {}) {
  if (!state || state.done) return state;
  if (action.type === "CANCEL") return { ...state, done: true, cancelled: true, providerCalls: 0, provider_calls: 0 };
  if (action.type === "OPEN_WHY") return { ...state, overlay: state.overlay?.type === "why" ? null : { type: "why", page: 0 } };
  if (action.type === "OPEN_PREVIEW") return { ...state, overlay: state.overlay?.type === "preview" ? null : { type: "preview", page: 0 } };
  if (state.overlay) {
    if (action.type === "CLOSE_OVERLAY") return { ...state, overlay: null };
    if (action.type === "PAGE") {
      const pageSize = Math.max(1, Number(action.pageSize) || PREVIEW_PAGE_SIZE);
      const maxPage = state.overlay.type === "preview" ? Math.ceil(previewModel(state.decisions).lines.length / pageSize) - 1 : 0;
      const page = Math.max(0, Math.min(maxPage, state.overlay.page + Math.sign(action.delta || 0)));
      return { ...state, overlay: { ...state.overlay, page } };
    }
    return state;
  }
  if (action.type === "PATCH") return patchDecision(state, action.key, action.value);
  if (action.type === "TOGGLE_HARNESS" && HARNESSES.some((item) => item.value === action.value)) return toggleHarness(state, action.value);
  if (action.type === "FOCUS_CONTROL") {
    const focus = controls(state).indexOf(action.control);
    return focus < 0 ? state : { ...state, focus };
  }
  if (action.type === "MOVE") return { ...state, focus: (boundedFocus(state) + (action.delta || 0) + controls(state).length) % controls(state).length };
  if (action.type === "CHANGE") return change(state, action.delta || 1);
  if (action.type === "ACTIVATE") return activate(state);
  if (action.type === "BACK") return back(state);
  if (action.type === "USE_RECOMMENDED") {
    const decisions = { ...state.recommendation.decisions, selectedHarnesses: [...state.recommendation.decisions.selectedHarnesses] };
    return go({ ...state, decisions }, "Review");
  }
  if (action.type === "CUSTOMIZE") return go(state, "Choose");
  if (action.type === "EDIT" && state.phase === "Review") return go(state, "Configure");
  if (action.type === "NEXT" && state.phase === "Choose") return go(state, "Configure");
  if (action.type === "NEXT" && state.phase === "Configure") return go(state, "Review");
  if (action.type === "CONTINUE" && state.phase === "Review") return { ...go(state, "Apply"), reviewVisited: true };
  if (action.type === "CONFIRM" && state.phase === "Apply" && state.reviewVisited) {
    return {
      ...state,
      decisions: { ...state.decisions, apply: state.decisions.applyIntent === "apply-safe-steps" },
      done: true,
      providerCalls: 0,
      provider_calls: 0
    };
  }
  if (action.type === "INPUT" && state.phase === "Configure") {
    const control = controls(state)[boundedFocus(state)];
    if (control === "name" || control === "path") return patchDecision(state, control, `${control === "name" ? state.decisions.name : state.decisions.targetPath}${String(action.text || "").replace(/[\r\n]/g, "")}`);
  }
  if (action.type === "BACKSPACE" && state.phase === "Configure") {
    const control = controls(state)[boundedFocus(state)];
    if (control === "name") return patchDecision(state, "name", state.decisions.name.slice(0, -1));
    if (control === "path") return patchDecision(state, "path", state.decisions.targetPath.slice(0, -1));
  }
  return { ...state, providerCalls: 0, provider_calls: 0 };
}

function effective(decisions) {
  return {
    ...decisions,
    profileStrategy: decisions.edition === "memory" ? "not-needed-for-memory-edition" : decisions.profileStrategy,
    memorySetup: decisions.edition === "coding" ? "not-needed-for-coding-edition" : decisions.memorySetup,
    name: decisions.name.trim() || "acme"
  };
}

export function previewModel(decisions) {
  const value = effective(decisions);
  const harnesses = value.selectedHarnesses.length ? value.selectedHarnesses.join(",") : "none";
  const path = value.targetPath.trim() || `~/.alfred/installs/${value.name}`;
  return {
    concise: `${value.edition} | ${harnesses} | ${value.profileStrategy} | ${value.memorySetup} | ${value.applyIntent}`,
    lines: [
      "Full install preview",
      `Edition: ${value.edition}`,
      `Harnesses: ${harnesses}`,
      `Runtime profile strategy: ${value.profileStrategy}`,
      `Memory setup: ${value.memorySetup}`,
      `Install name: ${value.name}`,
      `Target path: ${path}`,
      `Execution intent: ${value.applyIntent}`,
      `Apply confirmed: ${value.apply ? "yes" : "no"}`,
      "Safety: preview-only is the default.",
      "Safety: no live harness configuration is written by this TUI.",
      "Safety: install.sh remains the apply authority.",
      "Profiles: shared defaults may use machine-local overlays.",
      "Harness previews: generated only for selected targets after apply.",
      MODEL_GUIDANCE,
      "Recommendation inputs: current values plus local harness status only.",
      "Recommendation event: installer_recommendation_computed.",
      "Provider calls: 0",
      "Review is required before interactive confirmation."
    ],
    providerCalls: 0,
    provider_calls: 0
  };
}

function marker(focused) {
  return focused ? ">" : " ";
}

function bodyEntries(state) {
  const d = effective(state.decisions);
  const focus = controls(state)[boundedFocus(state)];
  if (state.phase === "Discover") {
    const installed = HARNESSES.filter((item) => state.recommendation.harnessStatus[item.value] === "installed").map((item) => item.label);
    return [
      { text: `Local discovery checked: ${installed.length ? `installed ${installed.join(", ")}` : "no supported harness installed"}.` },
      { text: `Recommended: ${previewModel(state.recommendation.decisions).concise}` },
      { text: "Recommendation is deterministic, preview-first, and makes no provider calls." },
      { text: `${marker(focus === "recommended")} [r] Use recommended setup`, action: { type: "USE_RECOMMENDED" } },
      { text: `${marker(focus === "customize")} Customize choices`, action: { type: "CUSTOMIZE" } }
    ];
  }
  if (state.phase === "Choose") return [
    { text: `${marker(focus === "edition")} Edition: ${d.edition} (left/right)`, action: { type: "CHANGE", delta: 1 } },
    ...HARNESSES.map((item) => ({
      text: `${marker(focus === `harness:${item.value}`)} ${d.selectedHarnesses.includes(item.value) ? "[x]" : "[ ]"} ${item.label}`,
      action: { type: "TOGGLE_HARNESS", value: item.value }
    })),
    { text: `${marker(focus === "profile")} Profiles: ${d.profileStrategy}${d.edition === "memory" ? " (not needed)" : ""}`, action: { type: "CHANGE", delta: 1 } },
    { text: `${marker(focus === "next")} Continue to Configure`, action: { type: "NEXT" } }
  ];
  if (state.phase === "Configure") return [
    { text: `${marker(focus === "memory")} Memory: ${d.memorySetup}${d.edition === "coding" ? " (not needed)" : ""}`, action: { type: "CHANGE", delta: 1 } },
    { text: `${marker(focus === "name")} Name: [${d.name}${focus === "name" ? "_" : ""}]`, action: { type: "FOCUS_CONTROL", control: "name" } },
    { text: `${marker(focus === "path")} Path: [${d.targetPath || `~/.alfred/installs/${d.name}`}${focus === "path" ? "_" : ""}]`, action: { type: "FOCUS_CONTROL", control: "path" } },
    { text: `${marker(focus === "intent")} Intent: ${d.applyIntent} (preview-only recommended)`, action: { type: "CHANGE", delta: 1 } },
    { text: `${marker(focus === "next")} Continue to mandatory Review`, action: { type: "NEXT" } }
  ];
  if (state.phase === "Review") return [
    { text: "Review every choice before entering final confirmation." },
    ...previewModel(d).lines.slice(1, 9).map((text) => ({ text })),
    { text: `${marker(focus === "continue")} Continue to Apply confirmation`, action: { type: "CONTINUE" } },
    { text: `${marker(focus === "edit")} Edit configuration`, action: { type: "EDIT" } }
  ];
  return [
    { text: d.applyIntent === "apply-safe-steps" ? "Explicitly confirm safe apply steps." : "Confirm preview-only output; no install files will be written." },
    { text: "Live harness configuration still requires separate approval." },
    { text: `${marker(focus === "confirm")} Confirm ${d.applyIntent}`, action: { type: "CONFIRM" } },
    { text: `${marker(focus === "back")} Back to Review`, action: { type: "BACK" } }
  ];
}

function rationaleLines(state) {
  const reasonText = {
    "edition-current-value": "Kept the valid current edition.",
    "edition-coding-default": "Coding is the safe suite default.",
    "harness-explicit-selection": "Kept explicit harness choices.",
    "harness-installed-auto": "Auto selected installed harnesses.",
    "harness-none-installed": "No installed harness was selected.",
    "profiles-not-needed": "Memory edition needs no runtime profiles.",
    "profiles-current-value": "Kept the current profile choice.",
    "profiles-runtime-default": "Coding/full recommend runtime profiles.",
    "memory-not-needed": "Coding edition needs no Memory setup.",
    "memory-current-value": "Kept the current Memory setup.",
    "memory-decide-later-default": "Memory/full can decide storage later.",
    "execution-preview-default": "Preview-only prevents implicit writes.",
    "models-user-owned": MODEL_GUIDANCE
  };
  return ["Why this recommendation", ...state.recommendation.reasons.map((code) => reasonText[code] || code), "Provider calls: 0"];
}

function clip(text, width) {
  const value = String(text);
  if (value.length <= width) return value;
  return width <= 1 ? value.slice(0, width) : `${value.slice(0, width - 1)}…`;
}

function pad(text, width) {
  const value = clip(text, width);
  return `${value}${" ".repeat(Math.max(0, width - value.length))}`;
}

export function render(state, { columns = 80, rows = 24 } = {}) {
  const width = Math.max(20, Number(columns) || 80);
  const height = Math.max(8, Number(rows) || 24);
  const wide = width >= 100;
  const phaseIndex = Math.max(0, PHASES.indexOf(state.phase));
  const title = wide
    ? `Alfred installer | ${PHASES.map((phase) => phase === state.phase ? `[${phase}]` : phase).join(" > ")}`
    : `Alfred installer | ${phaseIndex + 1}/${PHASES.length} ${state.phase}`;
  let entries;
  let pageLabel = "";
  if (state.overlay?.type === "why") entries = rationaleLines(state).map((text) => ({ text }));
  else if (state.overlay?.type === "preview") {
    const all = previewModel(state.decisions).lines;
    const pageSize = previewPageSize({ columns: width, rows: height });
    const pageCount = Math.max(1, Math.ceil(all.length / pageSize));
    const page = Math.min(state.overlay.page, pageCount - 1);
    entries = all.slice(page * pageSize, (page + 1) * pageSize).map((text) => ({ text }));
    pageLabel = ` | page ${page + 1}/${pageCount}`;
  } else entries = bodyEntries(state);

  const footer = [
    `Phase ${phaseIndex + 1}/${PHASES.length}: ${state.phase}${state.overlay ? ` | ${state.overlay.type}${pageLabel}` : ""} | provider calls: 0`,
    `Preview: ${previewModel(state.decisions).concise}`,
    state.overlay ? "Keys: Esc close | p Preview | w Why | arrows page | q cancel" : "Keys: arrows move/change | Space/Enter select | b Back | r Recommended",
    "Keys: p full Preview | w Why | q cancel"
  ];
  const available = Math.max(1, height - footer.length - 1);
  const lines = [clip(title, width)];
  const hitRegions = [];
  if (wide && !state.overlay) {
    const gap = 3;
    const leftWidth = Math.floor((width - gap) * 0.58);
    const rightWidth = width - gap - leftWidth;
    const reasons = rationaleLines(state);
    const count = Math.min(available, Math.max(entries.length, reasons.length));
    for (let index = 0; index < count; index += 1) {
      const entry = entries[index];
      lines.push(`${pad(entry?.text || "", leftWidth)}${" ".repeat(gap)}${clip(reasons[index] || "", rightWidth)}`);
      if (entry?.action) hitRegions.push({ x1: 1, x2: leftWidth, y1: lines.length, y2: lines.length, action: entry.action });
    }
  } else {
    const visible = entries.slice(0, available);
    for (const entry of visible) {
      lines.push(clip(entry.text, width));
      if (entry.action) hitRegions.push({ x1: 1, x2: width, y1: lines.length, y2: lines.length, action: entry.action });
    }
  }
  while (lines.length < height - footer.length) lines.push("");
  for (const line of footer) lines.push(clip(line, width));
  return { text: lines.slice(0, height).join("\n"), hitRegions, providerCalls: 0, provider_calls: 0 };
}

function shellQuote(value) {
  return String(value).replace(/\n/g, "").replace(/'/g, "'\\''");
}

export function serializeAssignments(decisions) {
  const value = effective(decisions);
  const harnesses = value.selectedHarnesses.length ? value.selectedHarnesses.join(",") : "none";
  const lines = [
    `EDITION='${shellQuote(value.edition)}'`,
    `HARNESS='${shellQuote(harnesses)}'`,
    `PROFILE_STRATEGY='${shellQuote(value.profileStrategy)}'`,
    `MEMORY_SETUP='${shellQuote(value.memorySetup)}'`,
    `NAME='${shellQuote(value.name)}'`,
    `APPLY='${value.apply ? "true" : "false"}'`,
    `SKIP_PROFILE_MANAGER='${value.profileStrategy === "decide-later" ? "true" : "false"}'`,
    "TUI_USED='true'",
    "TUI_MODE='app'"
  ];
  if (value.targetPath.trim()) lines.push(`TARGET_PATH='${shellQuote(value.targetPath.trim())}'`);
  return `${lines.join("\n")}\n`;
}
