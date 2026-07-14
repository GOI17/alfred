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
export const MODEL_STRATEGIES = ["smart-defaults", "keep-existing", "configure-later"];

export const LABELS = Object.freeze({
  editions: Object.freeze(Object.fromEntries(EDITIONS.map(({ value, label }) => [value, label]))),
  profiles: Object.freeze({ "runtime-profiles": "Runtime profiles", "decide-later": "Configure later" }),
  memory: Object.freeze(Object.fromEntries(MEMORY_SETUPS.map(({ value, label }) => [value, label]))),
  models: Object.freeze({
    "smart-defaults": "Use detected smart defaults",
    "keep-existing": "Keep existing model configuration",
    "configure-later": "Configure models later"
  }),
  intents: Object.freeze({ "preview-only": "Preview only", "apply-safe-steps": "Apply safe steps" }),
  status: Object.freeze({ installed: "detected", "not-installed": "not detected", unknown: "unknown" })
});

const PROFILE_STRATEGIES = ["runtime-profiles", "decide-later"];
const APPLY_INTENTS = ["preview-only", "apply-safe-steps"];
const PREVIEW_PAGE_SIZE = 8;
const MIN_PANEL_CONTENT_HEIGHT = 4;
const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_AT_START_PATTERN = /^\x1b\[[0-?]*[ -/]*[@-~]/;
const COLOR = { reset: "\x1b[0m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", dim: "\x1b[2m" };
const GRAPHEME_SEGMENTER = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

function known(value, fallback = "unknown") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function safeSource(value) {
  if (typeof value !== "string") return "unknown";
  if (/^env:[A-Z][A-Z0-9_]*$/.test(value) || value.startsWith("socket:")) return value;
  return "unknown";
}

function safeConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const key of ["*", "orchestrator", "developer"]) {
    const entry = value[key];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const clean = {};
    if (typeof entry.primary === "string" && entry.primary.trim()) clean.primary = entry.primary;
    if (Array.isArray(entry.fallbacks)) clean.fallbacks = entry.fallbacks.filter((item) => typeof item === "string" && item.trim());
    if (Object.keys(clean).length) result[key] = clean;
  }
  result.fallbacks = Array.isArray(value.fallbacks) ? value.fallbacks.filter((item) => typeof item === "string" && item.trim()) : [];
  return result;
}

export function normalizeDiscovery(input, legacyHarnessStatus = {}) {
  const value = input?.schema === "alfred.install.discovery/v1" ? input : {};
  const legacy = asStatusMap(legacyHarnessStatus);
  const harnesses = Object.fromEntries(HARNESSES.map(({ value: id }) => {
    const status = value.harnesses?.[id] ?? legacy.get(id);
    return [id, status === "installed" || status === "not-installed" ? status : "unknown"];
  }));
  const suggestions = Array.isArray(value.models?.suggestions) ? value.models.suggestions.flatMap((item) => {
    if (!item || typeof item.provider !== "string" || typeof item.model !== "string") return [];
    return [{ provider: item.provider, model: item.model, source: safeSource(item.source) }];
  }) : [];
  return {
    schema: value.schema ?? "unknown",
    os: {
      platform: known(value.os?.platform),
      release: known(value.os?.release),
      architecture: known(value.os?.architecture)
    },
    node: {
      status: ["ok", "too-old", "missing"].includes(value.node?.status) ? value.node.status : "unknown",
      version: known(value.node?.version),
      major: Number.isInteger(value.node?.major) ? value.node.major : "unknown",
      required_major: Number.isInteger(value.node?.required_major) ? value.node.required_major : 22
    },
    harnesses,
    models: {
      suggestions,
      proposed_config: safeConfig(value.models?.proposed_config),
      validation: {
        status: value.models?.validation?.status === "pass" ? "pass" : value.models?.validation?.status === "fail" ? "fail" : "unknown",
        errors: Array.isArray(value.models?.validation?.errors) ? value.models.validation.errors.map(String) : []
      },
      existing_config: value.models?.existing_config === true
    },
    install: {
      alfred_home: known(value.install?.alfred_home),
      selected_target: known(value.install?.selected_target),
      target_exists: value.install?.target_exists === true,
      models_config_path: known(value.install?.models_config_path),
      models_config_exists: value.install?.models_config_exists === true
    },
    git: {
      availability: known(value.git?.availability),
      source_workspace_path: known(value.git?.source_workspace_path, known(value.git?.workspace_root)),
      workspace_root: known(value.git?.workspace_root),
      project_root: known(value.git?.project_root),
      repository_state: known(value.git?.repository_state),
      linked_worktree_state: known(value.git?.linked_worktree_state)
    },
    provider_calls: 0
  };
}

export function previewPageSize({ columns = 80, rows = 24 } = {}) {
  const width = Math.max(20, Number(columns) || 80);
  const height = Math.max(8, Number(rows) || 24);
  return width >= 100 ? Math.max(1, height - 8) : Math.max(1, Math.min(PREVIEW_PAGE_SIZE, height - 8));
}

function asStatusMap(status) {
  if (status instanceof Map) return new Map(status);
  if (typeof status === "string") return new Map(status.split(",").map((entry) => entry.split("=")).filter(([key, value]) => key && value));
  return new Map(Object.entries(status || {}));
}

export function parseHarnessSelection(value, status = new Map()) {
  const raw = Array.isArray(value) ? value : String(value ?? "auto").split(/[,+| ]+/).filter(Boolean);
  const selected = [];
  const add = (id) => { if (HARNESSES.some((item) => item.value === id) && !selected.includes(id)) selected.push(id); };
  for (const id of raw) {
    if (id === "auto") HARNESSES.filter((item) => status.get(item.value) === "installed").forEach((item) => add(item.value));
    else if (id === "codex") { add("codex-cli"); add("codex-app"); }
    else if (id !== "none" && id !== "decide-later") add(id);
  }
  return selected;
}

function freezeRecommendation(value) {
  Object.freeze(value.decisions.selectedHarnesses);
  Object.freeze(value.decisions);
  Object.freeze(value.reasons);
  Object.freeze(value.harnessStatus);
  Object.freeze(value.traceEvent.data.reasons);
  Object.freeze(value.traceEvent.data);
  Object.freeze(value.traceEvent);
  return Object.freeze(value);
}

export function recommend({ current = {}, harnessStatus = {}, discovery: discoveryInput } = {}) {
  const discovery = normalizeDiscovery(discoveryInput, harnessStatus);
  const status = asStatusMap(discovery.harnesses);
  const edition = EDITIONS.some((item) => item.value === current.edition) ? current.edition : "coding";
  const harnessSeed = current.harnesses ?? current.selectedHarnesses ?? current.harness ?? "auto";
  const harnessTokens = Array.isArray(harnessSeed) ? harnessSeed : String(harnessSeed).split(/[,+| ]+/).filter(Boolean);
  const validHarnessTokens = new Set(["auto", "none", "decide-later", "codex", ...HARNESSES.map((item) => item.value)]);
  const validHarnessSeed = harnessTokens.length > 0 && harnessTokens.every((value) => validHarnessTokens.has(value));
  const explicitHarness = validHarnessSeed && (Array.isArray(harnessSeed) || !harnessTokens.includes("auto"));
  const selectedHarnesses = parseHarnessSelection(validHarnessSeed ? harnessSeed : "auto", status);
  const profileSeed = current.profileStrategy ?? current.profile;
  const memorySeed = current.memorySetup ?? current.memory;
  const profileStrategy = edition === "memory" ? "not-needed-for-memory-edition" : PROFILE_STRATEGIES.includes(profileSeed) ? profileSeed : "runtime-profiles";
  const memorySetup = edition === "coding" ? "not-needed-for-coding-edition" : MEMORY_SETUPS.some((item) => item.value === memorySeed) ? memorySeed : "decide-later";
  const hasExistingModels = discovery.install.models_config_exists || discovery.models.existing_config;
  const hasSmartDefaults = discovery.models.validation.status === "pass" && Boolean(discovery.models.proposed_config["*"]?.primary);
  const modelStrategy = hasExistingModels ? "keep-existing" : hasSmartDefaults ? "smart-defaults" : "configure-later";
  const decisions = {
    edition,
    selectedHarnesses,
    profileStrategy,
    memorySetup,
    modelStrategy,
    modelWriteApproved: false,
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
    hasExistingModels ? "models-keep-existing" : hasSmartDefaults ? "models-smart-defaults" : "models-configure-later",
    "execution-preview-default"
  ];
  return freezeRecommendation({
    decisions,
    reasons,
    harnessStatus: { ...discovery.harnesses },
    discovery,
    providerCalls: 0,
    provider_calls: 0,
    traceEvent: { event: "installer_recommendation_computed", data: { reasons: [...reasons], provider_calls: 0 } }
  });
}

export function createPathfinderState(input = {}) {
  const recommendation = recommend(input);
  return {
    phase: "Discover",
    decisions: { ...recommendation.decisions, selectedHarnesses: [...recommendation.decisions.selectedHarnesses] },
    recommendation,
    discovery: recommendation.discovery,
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

function modelsApplicable(decisions) { return decisions.edition !== "memory"; }
function memoryApplicable(decisions) { return decisions.edition !== "coding"; }
function profilesApplicable(decisions) { return decisions.edition !== "memory"; }

export function controlsFor(state) {
  if (state.phase === "Discover") return ["recommended", "customize"];
  if (state.compatibilityPlayback && state.phase === "Choose") return ["edition", ...HARNESSES.map((item) => `harness:${item.value}`), "profile", "next"];
  if (state.compatibilityPlayback && state.phase === "Configure") return ["memory", "name", "path", "intent", "next"];
  if (state.phase === "Choose") return ["edition", ...HARNESSES.map((item) => `harness:${item.value}`), ...(profilesApplicable(state.decisions) ? ["profile"] : []), "next"];
  if (state.phase === "Configure") return [...(memoryApplicable(state.decisions) ? ["memory"] : []), ...(modelsApplicable(state.decisions) ? ["models"] : []), "name", "path", "intent", "next"];
  if (state.phase === "Review") return [
    ...(modelsApplicable(state.decisions) && state.decisions.modelStrategy === "smart-defaults" ? ["model-approval"] : []),
    "continue", "edit"
  ];
  return [...(modelsApplicable(state.decisions) && state.decisions.modelStrategy === "smart-defaults" ? ["model-approval"] : []), "confirm", "back"];
}

function boundedFocus(state, focus = state.focus) { return Math.max(0, Math.min(controlsFor(state).length - 1, focus)); }
function go(state, phase) { return { ...state, phase, focus: 0, history: [...state.history, state.phase] }; }
function back(state) {
  if (!state.history.length) return state;
  const history = [...state.history];
  return { ...state, phase: history.pop(), history, focus: 0 };
}
function cycle(values, value, delta) {
  const index = Math.max(0, values.indexOf(value));
  return values[(index + delta + values.length) % values.length];
}
function availableModelStrategies(state) {
  const values = state.discovery.install.models_config_exists || state.discovery.models.existing_config
    ? ["keep-existing", "smart-defaults", "configure-later"]
    : ["smart-defaults", "configure-later"];
  if (!state.discovery.models.proposed_config["*"]?.primary) return values.filter((value) => value !== "smart-defaults");
  return values;
}
function withEdition(decisions, edition) {
  const next = { ...decisions, edition, modelWriteApproved: false };
  if (edition === "memory") next.profileStrategy = "not-needed-for-memory-edition";
  else if (next.profileStrategy === "not-needed-for-memory-edition") next.profileStrategy = "runtime-profiles";
  if (edition === "coding") next.memorySetup = "not-needed-for-coding-edition";
  else if (next.memorySetup === "not-needed-for-coding-edition") next.memorySetup = "decide-later";
  if (edition === "memory") next.modelStrategy = "configure-later";
  return next;
}

function patchDecision(state, key, value) {
  let decisions = { ...state.decisions, selectedHarnesses: [...state.decisions.selectedHarnesses] };
  if (key === "edition" && EDITIONS.some((item) => item.value === value)) decisions = withEdition(decisions, value);
  if ((key === "harness" || key === "harnesses") && value !== undefined) decisions.selectedHarnesses = parseHarnessSelection(value);
  if ((key === "profiles" || key === "profileStrategy") && PROFILE_STRATEGIES.includes(value)) decisions.profileStrategy = value;
  if ((key === "memory" || key === "memorySetup") && MEMORY_SETUPS.some((item) => item.value === value)) decisions.memorySetup = value;
  if ((key === "models" || key === "modelStrategy") && MODEL_STRATEGIES.includes(value) && availableModelStrategies(state).includes(value)) {
    decisions.modelStrategy = value;
    decisions.modelWriteApproved = false;
  }
  if (key === "modelWriteApproved" && [true, false, "true", "false"].includes(value) && ["Review", "Apply"].includes(state.phase)) {
    decisions.modelWriteApproved = value === true || value === "true";
  }
  if (key === "name") decisions.name = String(value);
  if (key === "path" || key === "targetPath") decisions.targetPath = String(value);
  if (key === "apply") {
    decisions.apply = value === true || value === "true" || value === "yes";
    decisions.applyIntent = decisions.apply ? "apply-safe-steps" : "preview-only";
  }
  if (key === "applyIntent" && APPLY_INTENTS.includes(value)) {
    decisions.applyIntent = value;
    decisions.apply = false;
    if (value === "preview-only") decisions.modelWriteApproved = false;
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
  const control = controlsFor(state)[boundedFocus(state)];
  if (control === "edition") return { ...state, decisions: withEdition(state.decisions, cycle(EDITIONS.map((item) => item.value), state.decisions.edition, delta)) };
  if (control.startsWith("harness:")) return toggleHarness(state, control.slice(8));
  if (control === "profile") return patchDecision(state, "profileStrategy", cycle(PROFILE_STRATEGIES, state.decisions.profileStrategy, delta));
  if (control === "memory") return patchDecision(state, "memorySetup", cycle(MEMORY_SETUPS.map((item) => item.value), state.decisions.memorySetup, delta));
  if (control === "models") return patchDecision(state, "modelStrategy", cycle(availableModelStrategies(state), state.decisions.modelStrategy, delta));
  if (control === "intent") return patchDecision(state, "applyIntent", cycle(APPLY_INTENTS, state.decisions.applyIntent, delta));
  return state;
}
function activate(state) {
  const control = controlsFor(state)[boundedFocus(state)];
  if (control === "recommended") return transition(state, { type: "USE_RECOMMENDED" });
  if (control === "customize") return transition(state, { type: "CUSTOMIZE" });
  if (control?.startsWith("harness:")) return toggleHarness(state, control.slice(8));
  if (["profile", "memory", "models", "intent"].includes(control)) return change(state, 1);
  if (control === "model-approval") return patchDecision(state, "modelWriteApproved", !state.decisions.modelWriteApproved);
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
      const maxPage = state.overlay.type === "preview" ? Math.max(0, Math.ceil(previewModel(state.decisions, state.discovery).lines.length / pageSize) - 1) : 0;
      return { ...state, overlay: { ...state.overlay, page: Math.max(0, Math.min(maxPage, state.overlay.page + Math.sign(action.delta || 0))) } };
    }
    return state;
  }
  if (action.type === "PATCH") return patchDecision(state, action.key, action.value);
  if (action.type === "TOGGLE_HARNESS" && HARNESSES.some((item) => item.value === action.value)) return toggleHarness(state, action.value);
  if (action.type === "FOCUS_CONTROL") {
    const focus = controlsFor(state).indexOf(action.control);
    return focus < 0 ? state : { ...state, focus };
  }
  if (action.type === "MOVE") return { ...state, focus: (boundedFocus(state) + (action.delta || 0) + controlsFor(state).length) % controlsFor(state).length };
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
    const apply = state.decisions.applyIntent === "apply-safe-steps";
    return {
      ...state,
      decisions: { ...state.decisions, apply, modelWriteApproved: apply && state.decisions.modelWriteApproved },
      done: true,
      providerCalls: 0,
      provider_calls: 0
    };
  }
  if (action.type === "INPUT" && state.phase === "Configure") {
    const control = controlsFor(state)[boundedFocus(state)];
    if (control === "name" || control === "path") return patchDecision(state, control, `${control === "name" ? state.decisions.name : state.decisions.targetPath}${String(action.text || "").replace(/[\r\n]/g, "")}`);
  }
  if (action.type === "BACKSPACE" && state.phase === "Configure") {
    const control = controlsFor(state)[boundedFocus(state)];
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
    modelStrategy: decisions.edition === "memory" ? "configure-later" : decisions.modelStrategy,
    modelWriteApproved: decisions.edition !== "memory" && decisions.modelWriteApproved === true,
    name: decisions.name.trim() || "acme"
  };
}
function modelConfigLines(config = {}) {
  return [
    `Wildcard primary: ${config["*"]?.primary || "none detected"}`,
    `Orchestrator override: ${config.orchestrator?.primary || "uses wildcard"}`,
    `Developer override: ${config.developer?.primary || "uses wildcard"}`,
    `Global fallback chain: ${config.fallbacks?.length ? config.fallbacks.join(" → ") : "none detected"}`
  ];
}

function effectiveTargetPath(decisions) {
  const value = effective(decisions);
  return value.targetPath.trim() || `~/.alfred/installs/${value.name}`;
}

function modelStrategyLines(value, discovery) {
  if (value.modelStrategy === "smart-defaults") {
    return [
      ...modelConfigLines(discovery.models?.proposed_config),
      `Model write approved: ${value.modelWriteApproved ? "yes" : "no"}`
    ];
  }
  if (value.modelStrategy === "keep-existing") {
    return ["Existing model file remains untouched and was not read into the TUI."];
  }
  return ["No model configuration will be written."];
}

export function previewModel(decisions, discoveryInput) {
  const discovery = discoveryInput?.schema ? normalizeDiscovery(discoveryInput) : discoveryInput ?? normalizeDiscovery();
  const value = effective(decisions);
  const harnesses = value.selectedHarnesses.length ? value.selectedHarnesses.map((id) => HARNESSES.find((item) => item.value === id)?.label || id).join(", ") : "None";
  const targetPath = effectiveTargetPath(value);
  const lines = ["Full install preview", `Edition: ${LABELS.editions[value.edition]}`, `Harnesses: ${harnesses}`];
  if (profilesApplicable(value)) lines.push(`Runtime profile strategy: ${LABELS.profiles[value.profileStrategy]}`);
  if (memoryApplicable(value)) lines.push(`Memory setup: ${LABELS.memory[value.memorySetup]}`);
  if (modelsApplicable(value)) {
    lines.push(`Model strategy: ${LABELS.models[value.modelStrategy]}`);
    lines.push(...modelStrategyLines(value, discovery));
  }
  lines.push(
    `Install name: ${value.name}`,
    `Target path: ${targetPath}`,
    `Execution intent: ${LABELS.intents[value.applyIntent]}`,
    `Apply confirmed: ${value.apply ? "yes" : "no"}`,
    "Safety: preview-only is the default.",
    "Safety: no live harness configuration is written by this TUI.",
    "Safety: install.sh remains the apply authority.",
    "Provider calls: 0",
    "Review is required before interactive confirmation."
  );
  return {
    concise: `${LABELS.editions[value.edition]} | ${harnesses} | ${modelsApplicable(value) ? LABELS.models[value.modelStrategy] : LABELS.memory[value.memorySetup]} | ${LABELS.intents[value.applyIntent]}`,
    lines,
    providerCalls: 0,
    provider_calls: 0
  };
}

function marker(focused) { return focused ? ">" : " "; }
function decisionChanged(state, key, normalize = (value) => value) {
  return JSON.stringify(normalize(state.decisions[key])) !== JSON.stringify(normalize(state.recommendation.decisions[key]));
}
function changedSuffix(changed) { return changed ? " [changed]" : ""; }
function bodyEntries(state) {
  const d = effective(state.decisions);
  const focus = controlsFor(state)[boundedFocus(state)];
  const discovery = state.discovery;
  if (state.phase === "Discover") {
    const harnesses = HARNESSES.filter((item) => discovery.harnesses[item.value] === "installed").map((item) => item.label);
    const suggestions = discovery.models.suggestions.map((item) => `${item.model} (${item.source})`);
    return [
      { text: `OS: ${discovery.os.platform} ${discovery.os.release} · ${discovery.os.architecture}`, tone: "safe" },
      { text: `Node: ${discovery.node.version} · ${discovery.node.status} (requires ${discovery.node.required_major}+)`, tone: discovery.node.status === "ok" ? "safe" : "blocker" },
      { text: `Harnesses: ${harnesses.length ? harnesses.join(", ") : "none detected"}`, tone: harnesses.length ? "safe" : "normal" },
      { text: `Provider/model suggestions: ${suggestions.length ? suggestions.join(", ") : "none detected"}`, tone: suggestions.length ? "safe" : "normal" },
      { text: `Existing install: ${discovery.install.target_exists ? "found" : "not found"} at ${discovery.install.selected_target}`, tone: discovery.install.target_exists ? "safe" : "normal" },
      { text: `Models config: ${discovery.install.models_config_exists ? "existing config found" : "not present"}`, tone: discovery.install.models_config_exists ? "safe" : "normal" },
      { text: `Git: ${discovery.git.repository_state} · ${discovery.git.linked_worktree_state} · ${discovery.git.workspace_root}`, tone: discovery.git.repository_state === "repository" ? "safe" : "normal" },
      { text: `Project root: ${discovery.git.project_root}`, tone: discovery.git.repository_state === "repository" ? "safe" : "normal" },
      { text: `${marker(focus === "recommended")} [r] Use recommended setup`, action: { type: "USE_RECOMMENDED" }, focused: focus === "recommended" },
      { text: `${marker(focus === "customize")} Customize choices`, action: { type: "CUSTOMIZE" }, focused: focus === "customize" }
    ];
  }
  if (state.phase === "Choose") {
    const entries = [
      { text: `${marker(focus === "edition")} Edition: ${LABELS.editions[d.edition]}${changedSuffix(decisionChanged(state, "edition"))}`, action: { type: "CHANGE", delta: 1 }, focused: focus === "edition", tone: decisionChanged(state, "edition") ? "changed" : "normal" },
      ...HARNESSES.map((item) => ({
        text: `${marker(focus === `harness:${item.value}`)} ${d.selectedHarnesses.includes(item.value) ? "[x]" : "[ ]"} ${item.label} (${LABELS.status[discovery.harnesses[item.value]]})`,
        action: { type: "TOGGLE_HARNESS", value: item.value }, focused: focus === `harness:${item.value}`,
        tone: discovery.harnesses[item.value] === "installed" ? "safe" : "normal"
      }))
    ];
    if (profilesApplicable(d)) entries.push({ text: `${marker(focus === "profile")} Profiles: ${LABELS.profiles[d.profileStrategy]}${changedSuffix(decisionChanged(state, "profileStrategy"))}`, action: { type: "CHANGE", delta: 1 }, focused: focus === "profile", tone: decisionChanged(state, "profileStrategy") ? "changed" : "normal" });
    entries.push({ text: `${marker(focus === "next")} Continue to Configure`, action: { type: "NEXT" }, focused: focus === "next" });
    return entries;
  }
  if (state.phase === "Configure") {
    const entries = [];
    if (memoryApplicable(d)) entries.push({ text: `${marker(focus === "memory")} Memory: ${LABELS.memory[d.memorySetup]}${changedSuffix(decisionChanged(state, "memorySetup"))}`, action: { type: "CHANGE", delta: 1 }, focused: focus === "memory", tone: decisionChanged(state, "memorySetup") ? "changed" : "normal" });
    if (modelsApplicable(d)) {
      entries.push({ text: `${marker(focus === "models")} Models: ${LABELS.models[d.modelStrategy]}${changedSuffix(decisionChanged(state, "modelStrategy"))}`, action: { type: "CHANGE", delta: 1 }, focused: focus === "models", tone: decisionChanged(state, "modelStrategy") ? "changed" : "normal" });
      entries.push(...modelStrategyLines(d, discovery).map((text) => ({
        text: `  ${text}`,
        tone: d.modelStrategy === "smart-defaults" ? (discovery.models.proposed_config["*"]?.primary ? "safe" : "blocker") : "normal"
      })));
    }
    entries.push(
      { text: `${marker(focus === "name")} Name: [${d.name}${focus === "name" ? "_" : ""}]`, action: { type: "FOCUS_CONTROL", control: "name" }, focused: focus === "name" },
      { text: `${marker(focus === "path")} Path: [${d.targetPath || `~/.alfred/installs/${d.name}`}${focus === "path" ? "_" : ""}]`, action: { type: "FOCUS_CONTROL", control: "path" }, focused: focus === "path" },
      { text: `${marker(focus === "intent")} Intent: ${LABELS.intents[d.applyIntent]}${changedSuffix(decisionChanged(state, "applyIntent"))}`, action: { type: "CHANGE", delta: 1 }, focused: focus === "intent", tone: d.applyIntent === "apply-safe-steps" ? "changed" : "normal" },
      { text: `${marker(focus === "next")} Continue to mandatory Review`, action: { type: "NEXT" }, focused: focus === "next" }
    );
    return entries;
  }
  if (state.phase === "Review") {
    const entries = [{ text: "Review every choice before final confirmation." }, ...previewModel(d, discovery).lines.slice(1).map((text) => ({ text }))];
    if (modelsApplicable(d) && d.modelStrategy === "smart-defaults") entries.push({
      text: `${marker(focus === "model-approval")} [${d.modelWriteApproved ? "x" : " "}] Approve writing/replacing ${discovery.install.models_config_path}`,
      action: { type: "PATCH", key: "modelWriteApproved", value: !d.modelWriteApproved }, focused: focus === "model-approval", tone: "approval"
    });
    entries.push(
      { text: `${marker(focus === "continue")} Continue to Apply confirmation`, action: { type: "CONTINUE" }, focused: focus === "continue" },
      { text: `${marker(focus === "edit")} Edit configuration`, action: { type: "EDIT" }, focused: focus === "edit" }
    );
    return entries;
  }
  const entries = [
    { text: d.applyIntent === "apply-safe-steps" ? "Explicitly confirm safe apply steps." : "Confirm preview-only output; no install files will be written.", tone: d.applyIntent === "apply-safe-steps" ? "approval" : "safe" },
    { text: `Model write: ${d.modelWriteApproved ? "approved" : "not approved"}`, tone: d.modelWriteApproved ? "approval" : "safe" }
  ];
  if (modelsApplicable(d) && d.modelStrategy === "smart-defaults") entries.push({
    text: `${marker(focus === "model-approval")} [${d.modelWriteApproved ? "x" : " "}] Approve writing/replacing ${discovery.install.models_config_path}`,
    action: { type: "PATCH", key: "modelWriteApproved", value: !d.modelWriteApproved }, focused: focus === "model-approval", tone: "approval"
  });
  entries.push(
    { text: `${marker(focus === "confirm")} Confirm ${LABELS.intents[d.applyIntent]}`, action: { type: "CONFIRM" }, focused: focus === "confirm" },
    { text: `${marker(focus === "back")} Back to Review`, action: { type: "BACK" }, focused: focus === "back" }
  );
  return entries;
}

const REASON_TEXT = {
  "edition-current-value": "Kept the valid current edition.",
  "edition-coding-default": "Coding is the safe suite default.",
  "harness-explicit-selection": "Kept explicit harness choices.",
  "harness-installed-auto": "Selected locally detected harnesses.",
  "harness-none-installed": "No installed harness was selected.",
  "profiles-not-needed": "Memory edition needs no runtime profiles.",
  "profiles-current-value": "Kept the current profile choice.",
  "profiles-runtime-default": "Coding/full recommend runtime profiles.",
  "memory-not-needed": "Coding edition needs no Memory setup.",
  "memory-current-value": "Kept the current Memory setup.",
  "memory-decide-later-default": "Memory/full can decide storage later.",
  "models-keep-existing": "Existing model configuration is kept by default.",
  "models-smart-defaults": "Smart defaults use only locally detected suggestions.",
  "models-configure-later": "No validated model suggestion was detected.",
  "execution-preview-default": "Preview only prevents implicit writes."
};

export function rationaleLines(state) {
  const recommendation = state.recommendation.decisions;
  const current = effective(state.decisions);
  const lines = ["Why this recommendation"];
  const fields = [
    ["edition", "Edition", LABELS.editions],
    ["selectedHarnesses", "Harnesses", null],
    ...(profilesApplicable(current) ? [["profileStrategy", "Profiles", LABELS.profiles]] : []),
    ...(memoryApplicable(current) ? [["memorySetup", "Memory", LABELS.memory]] : []),
    ...(modelsApplicable(current) ? [["modelStrategy", "Models", LABELS.models]] : []),
    ["name", "Install name", null],
    ["targetPath", "Target path", null],
    ...(["Review", "Apply"].includes(state.phase) && modelsApplicable(current) && current.modelStrategy === "smart-defaults" ? [["modelWriteApproved", "Model write approval", { true: "Approved", false: "Not approved" }]] : []),
    ["applyIntent", "Execution", LABELS.intents]
  ];
  const reasonIndexes = { edition: 0, selectedHarnesses: 1, profileStrategy: 2, memorySetup: 3, modelStrategy: 4, applyIntent: 5 };
  for (const [key, label, labels] of fields) {
    const normalize = key === "selectedHarnesses" ? (value) => [...value].sort() : (value) => value;
    const currentValue = key === "targetPath" ? effectiveTargetPath(current) : current[key];
    const recommendedValue = key === "targetPath" ? effectiveTargetPath(recommendation) : recommendation[key];
    const changed = JSON.stringify(normalize(currentValue)) !== JSON.stringify(normalize(recommendedValue));
    const display = key === "selectedHarnesses"
      ? (currentValue.length ? currentValue.map((id) => HARNESSES.find((item) => item.value === id)?.label || id).join(", ") : "none")
      : (labels?.[currentValue] ?? currentValue);
    lines.push(changed
      ? `${label}: ${display}. Changed from recommendation; your selection is respected.`
      : `${label}: ${display}. ${REASON_TEXT[state.recommendation.reasons[reasonIndexes[key]]] || "Matches recommendation."}`);
  }
  lines.push("Provider calls: 0");
  return lines;
}

export function stripAnsi(text) { return String(text).replace(ANSI_PATTERN, ""); }
function graphemes(text) {
  if (!GRAPHEME_SEGMENTER) return Array.from(text);
  return Array.from(GRAPHEME_SEGMENTER.segment(text), ({ segment }) => segment);
}
function isFullWidth(codePoint) {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f || codePoint === 0x2329 || codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}
function graphemeWidth(grapheme) {
  if (!grapheme) return 0;
  if (/\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\u20E3/u.test(grapheme)) return 2;
  let width = 0;
  for (const character of Array.from(grapheme)) {
    const codePoint = character.codePointAt(0);
    if (codePoint === 0x200d || codePoint === 0xfe0e || codePoint === 0xfe0f || /\p{Mark}/u.test(character) || codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) continue;
    width += isFullWidth(codePoint) ? 2 : 1;
  }
  return width;
}
export function displayWidth(text) { return graphemes(stripAnsi(text)).reduce((total, grapheme) => total + graphemeWidth(grapheme), 0); }
export function clipAnsi(text, width) {
  const limit = Math.max(0, width);
  const original = String(text);
  if (displayWidth(original) <= limit) return original;
  const target = Math.max(0, limit - 1);
  let output = "";
  let visible = 0;
  for (let index = 0; index < original.length && visible < target;) {
    const rest = original.slice(index);
    const sgr = ANSI_AT_START_PATTERN.exec(rest);
    if (sgr) { output += sgr[0]; index += sgr[0].length; continue; }
    const nextAnsi = rest.search(/\x1b\[/);
    const textEnd = nextAnsi < 0 ? original.length : index + nextAnsi;
    const text = original.slice(index, textEnd);
    let consumed = 0;
    for (const grapheme of graphemes(text)) {
      const cellWidth = graphemeWidth(grapheme);
      if (visible + cellWidth > target) break;
      output += grapheme;
      visible += cellWidth;
      consumed += grapheme.length;
    }
    index += consumed;
    if (consumed < text.length) break;
  }
  const reset = /\x1b\[[0-?]*[ -/]*[@-~]/.test(original) ? COLOR.reset : "";
  return limit === 0 ? "" : limit === 1 ? "…" : `${output}…${reset}`;
}
export function padAnsi(text, width) {
  const value = clipAnsi(text, width);
  return `${value}${" ".repeat(Math.max(0, width - displayWidth(value)))}`;
}
function paint(text, tone, color) {
  if (!color) return text;
  const code = tone === "safe" ? COLOR.green : tone === "changed" || tone === "approval" ? COLOR.yellow : tone === "blocker" ? COLOR.red : tone === "focus" ? COLOR.cyan : "";
  return code ? `${code}${text}${COLOR.reset}` : text;
}
function fitPanelEntries(entries, contentHeight) {
  if (entries.length <= contentHeight) return entries;
  const actionable = entries.filter((entry) => entry.action);
  if (!actionable.length) return entries.slice(0, contentHeight);
  if (actionable.length >= contentHeight) {
    const focused = Math.max(0, actionable.findIndex((entry) => entry.focused));
    const start = Math.min(Math.max(0, focused - Math.floor(contentHeight / 2)), actionable.length - contentHeight);
    return actionable.slice(start, start + contentHeight);
  }
  const detailHeight = contentHeight - actionable.length;
  const details = entries.filter((entry) => !entry.action);
  const visibleDetails = details.slice(0, Math.max(0, detailHeight - 1));
  const hiddenCount = details.length - visibleDetails.length;
  return [
    ...visibleDetails,
    { text: `… ${hiddenCount} detail${hiddenCount === 1 ? "" : "s"} hidden; resize to view` },
    ...actionable
  ];
}
function panel(title, entries, width, contentHeight, { color, xOffset = 0, yOffset = 0 } = {}) {
  const inner = Math.max(1, width - 2);
  const titleText = ` ${title} `;
  const clippedTitle = clipAnsi(titleText, inner);
  const top = `┌${clippedTitle}${"─".repeat(Math.max(0, inner - displayWidth(clippedTitle)))}┐`;
  const lines = [paint(top, "focus", color)];
  const hitRegions = [];
  for (let index = 0; index < contentHeight; index += 1) {
    const entry = entries[index];
    const content = paint(entry?.text || "", entry?.focused ? "focus" : entry?.tone, color);
    lines.push(`${paint("│", "focus", color)}${padAnsi(content, inner)}${paint("│", "focus", color)}`);
    if (entry?.action) hitRegions.push({ x1: xOffset + 2, x2: xOffset + width - 1, y1: yOffset + lines.length, y2: yOffset + lines.length, action: entry.action });
  }
  lines.push(paint(`└${"─".repeat(inner)}┘`, "focus", color));
  return { lines, hitRegions };
}

export function render(state, { columns = 80, rows = 24, color = false } = {}) {
  const width = Math.max(20, Number(columns) || 80);
  const height = Math.max(8, Number(rows) || 24);
  const wide = width >= 100;
  const phaseIndex = Math.max(0, PHASES.indexOf(state.phase));
  const title = wide ? `Alfred installer | ${PHASES.map((phase) => phase === state.phase ? `[${phase}]` : phase).join(" > ")}` : `Alfred installer | ${phaseIndex + 1}/${PHASES.length} ${state.phase}`;
  let entries;
  let pageLabel = "";
  if (state.overlay?.type === "why") entries = rationaleLines(state).map((text) => ({ text }));
  else if (state.overlay?.type === "preview") {
    const all = previewModel(state.decisions, state.discovery).lines;
    const pageSize = previewPageSize({ columns: width, rows: height });
    const pageCount = Math.max(1, Math.ceil(all.length / pageSize));
    const page = Math.min(state.overlay.page, pageCount - 1);
    entries = all.slice(page * pageSize, (page + 1) * pageSize).map((text) => ({ text }));
    pageLabel = ` | page ${page + 1}/${pageCount}`;
  } else entries = bodyEntries(state);
  const footer = [
    `Phase ${phaseIndex + 1}/${PHASES.length}: ${state.phase}${state.overlay ? ` | ${state.overlay.type}${pageLabel}` : ""} | provider calls: 0`,
    `Preview: ${previewModel(state.decisions, state.discovery).concise}`,
    state.overlay ? "Keys: Esc close | arrows page | p Preview | w Why | q cancel" : "Keys: arrows move/change | Space/Enter select | b Back | r Recommended",
    "Keys: p full Preview | w Why | q cancel"
  ];
  const availableContentHeight = Math.max(1, height - footer.length - 3);
  const lines = [clipAnsi(paint(title, "focus", color), width)];
  const hitRegions = [];
  if (wide && !state.overlay) {
    const gap = 1;
    const leftWidth = Math.floor((width - gap) * 0.58);
    const rightWidth = width - gap - leftWidth;
    const reasons = rationaleLines(state).map((text) => ({ text, tone: text.includes("Changed from recommendation") ? "changed" : "normal" }));
    const contentHeight = Math.min(availableContentHeight, Math.max(MIN_PANEL_CONTENT_HEIGHT, entries.length, reasons.length));
    const panelHeight = contentHeight + 2;
    const left = panel(state.phase, fitPanelEntries(entries, contentHeight), leftWidth, contentHeight, { color, yOffset: 1 });
    const right = panel("Rationale", fitPanelEntries(reasons, contentHeight), rightWidth, contentHeight, { color, xOffset: leftWidth + gap, yOffset: 1 });
    for (let index = 0; index < panelHeight; index += 1) lines.push(`${padAnsi(left.lines[index], leftWidth)} ${right.lines[index]}`);
    hitRegions.push(...left.hitRegions, ...right.hitRegions);
  } else {
    const contentHeight = Math.min(availableContentHeight, Math.max(MIN_PANEL_CONTENT_HEIGHT, entries.length));
    const single = panel(state.overlay?.type === "why" ? "Rationale" : state.overlay?.type === "preview" ? "Preview" : state.phase, fitPanelEntries(entries, contentHeight), width, contentHeight, { color, yOffset: 1 });
    lines.push(...single.lines);
    hitRegions.push(...single.hitRegions);
  }
  for (const line of footer) lines.push(clipAnsi(line, width));
  return { text: lines.slice(0, height).join("\n"), hitRegions, providerCalls: 0, provider_calls: 0 };
}

function shellQuote(value) { return String(value).replace(/\n/g, "").replace(/'/g, "'\\''"); }
export function serializeAssignments(decisions, { reviewVisited = false } = {}) {
  const value = effective(decisions);
  const harnesses = value.selectedHarnesses.length ? value.selectedHarnesses.join(",") : "none";
  const modelApproved = reviewVisited && value.apply && value.modelStrategy === "smart-defaults" && value.modelWriteApproved;
  const lines = [
    `EDITION='${shellQuote(value.edition)}'`,
    `HARNESS='${shellQuote(harnesses)}'`,
    `PROFILE_STRATEGY='${shellQuote(value.profileStrategy)}'`,
    `MEMORY_SETUP='${shellQuote(value.memorySetup)}'`,
    `NAME='${shellQuote(value.name)}'`,
    `APPLY='${value.apply ? "true" : "false"}'`,
    `SKIP_PROFILE_MANAGER='${value.profileStrategy === "decide-later" ? "true" : "false"}'`,
    "TUI_USED='true'",
    "TUI_MODE='app'",
    `MODEL_STRATEGY='${shellQuote(value.modelStrategy)}'`,
    `MODEL_WRITE_APPROVED='${modelApproved ? "true" : "false"}'`
  ];
  if (value.targetPath.trim()) lines.push(`TARGET_PATH='${shellQuote(value.targetPath.trim())}'`);
  return `${lines.join("\n")}\n`;
}
