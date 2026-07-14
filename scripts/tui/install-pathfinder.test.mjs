#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  PHASES,
  clipAnsi,
  controlsFor,
  createPathfinderState,
  displayWidth,
  normalizeDiscovery,
  previewModel,
  previewPageSize,
  recommend,
  render,
  rationaleLines,
  serializeAssignments,
  stripAnsi,
  transition
} from "./install-pathfinder.mjs";
import { decodeTerminalEvent, printableInputAction, sgrMouseAction } from "./install-app.mjs";

const defaults = recommend({
  current: {},
  harnessStatus: { opencode: "installed", "codex-cli": "not-installed", "codex-app": "installed", pi: "not-installed" }
});
assert.equal(defaults.decisions.edition, "coding");
assert.deepEqual(defaults.decisions.selectedHarnesses, ["opencode", "codex-app"]);
assert.equal(defaults.decisions.profileStrategy, "runtime-profiles");
assert.equal(defaults.decisions.memorySetup, "not-needed-for-coding-edition");
assert.equal(defaults.decisions.applyIntent, "preview-only");
assert.equal(defaults.decisions.apply, false);
assert.equal(defaults.decisions.modelStrategy, "configure-later");
assert.equal(defaults.providerCalls, 0);
assert.equal(defaults.provider_calls, 0);
assert.equal(defaults.traceEvent.data.provider_calls, 0);

const invalidHarness = recommend({ current: { harness: "unsupported" }, harnessStatus: { pi: "installed" } });
assert.deepEqual(invalidHarness.decisions.selectedHarnesses, ["pi"], "invalid harness values use the auto fallback");

const explicit = recommend({
  current: { edition: "full", harness: "codex", profile: "decide-later", memory: "postgres", name: "team", path: "/tmp/team" },
  harnessStatus: { opencode: "installed" }
});
assert.deepEqual(explicit.decisions.selectedHarnesses, ["codex-cli", "codex-app"]);
assert.equal(explicit.decisions.profileStrategy, "decide-later");
assert.equal(explicit.decisions.memorySetup, "postgres");
assert.equal(explicit.decisions.name, "team");
assert.equal(explicit.decisions.targetPath, "/tmp/team");

const memory = recommend({ current: { edition: "memory", harness: "none" } });
assert.equal(memory.decisions.profileStrategy, "not-needed-for-memory-edition");
assert.equal(memory.decisions.memorySetup, "decide-later");
assert.deepEqual(memory.decisions.selectedHarnesses, []);
assert.deepEqual(PHASES, ["Discover", "Choose", "Configure", "Review", "Apply"]);

const discovery = normalizeDiscovery({
  schema: "alfred.install.discovery/v1",
  os: { platform: "linux", release: "fixture", architecture: "arm64" },
  node: { status: "ok", version: "v24.1.0", major: 24, required_major: 22 },
  harnesses: { opencode: "installed", "codex-cli": "not-installed", "codex-app": "installed", pi: "not-installed" },
  models: {
    suggestions: [
      { provider: "ollama", model: "ollama/qwen2.5-coder:7b", source: "socket:/tmp/ollama.sock" },
      { provider: "anthropic", model: "anthropic/claude-sonnet-4", source: "env:ANTHROPIC_API_KEY" }
    ],
    proposed_config: {
      "*": { primary: "ollama/qwen2.5-coder:7b", fallbacks: ["anthropic/claude-sonnet-4"] },
      orchestrator: { primary: "anthropic/claude-sonnet-4" },
      developer: { primary: "anthropic/claude-sonnet-4" },
      fallbacks: ["ollama/qwen2.5-coder:7b", "anthropic/claude-sonnet-4"]
    },
    validation: { status: "pass", errors: [] },
    existing_config: false
  },
  install: {
    alfred_home: "/home/test/.alfred", selected_target: "/home/test/.alfred/installs/acme",
    target_exists: true, models_config_path: "/home/test/.alfred/models.json", models_config_exists: false
  },
  git: {
    availability: "installed", workspace_root: "/workspace", project_root: "/workspace",
    repository_state: "repository", linked_worktree_state: "linked-worktree"
  },
  provider_calls: 0
});
const discoveredRecommendation = recommend({ discovery });
assert.equal(discoveredRecommendation.decisions.modelStrategy, "smart-defaults");
assert.equal(discoveredRecommendation.discovery.models.suggestions[1].source, "env:ANTHROPIC_API_KEY");
assert.equal(discoveredRecommendation.provider_calls, 0);

const existingDiscovery = { ...discovery, models: { ...discovery.models, existing_config: true }, install: { ...discovery.install, models_config_exists: true } };
assert.equal(recommend({ discovery: existingDiscovery }).decisions.modelStrategy, "keep-existing");

let quick = createPathfinderState({ current: {}, harnessStatus: { opencode: "installed" } });
quick = transition(quick, { type: "USE_RECOMMENDED" });
assert.equal(quick.phase, "Review");
assert.equal(quick.decisions.apply, false);
quick = transition(quick, { type: "CONTINUE" });
assert.equal(quick.phase, "Apply");
quick = transition(quick, { type: "CONFIRM" });
assert.equal(quick.done, true);
assert.equal(quick.decisions.apply, false);

let custom = createPathfinderState();
custom = transition(custom, { type: "CUSTOMIZE" });
assert.equal(custom.phase, "Choose");
custom = transition(custom, { type: "NEXT" });
assert.equal(custom.phase, "Configure");
custom = transition(custom, { type: "PATCH", key: "name", value: "edited" });
custom = transition(custom, { type: "PATCH", key: "applyIntent", value: "apply-safe-steps" });
const backed = transition(custom, { type: "BACK" });
assert.equal(backed.phase, "Choose");
assert.equal(backed.decisions.name, "edited", "Back must preserve edits");
custom = transition(backed, { type: "NEXT" });
custom = transition(custom, { type: "NEXT" });
assert.equal(custom.phase, "Review");
assert.equal(transition(custom, { type: "CONFIRM" }).done, false, "Review cannot be bypassed");
custom = transition(custom, { type: "CONTINUE" });
custom = transition(custom, { type: "CONFIRM" });
assert.equal(custom.done, true);
assert.equal(custom.decisions.apply, true, "apply requires explicit confirmation after Review");

let overlayState = createPathfinderState();
for (const phase of PHASES) {
  overlayState = { ...overlayState, phase, done: false };
  const preview = transition(overlayState, { type: "OPEN_PREVIEW" });
  assert.equal(preview.overlay.type, "preview", `preview opens from ${phase}`);
  assert.equal(transition(preview, { type: "CLOSE_OVERLAY" }).overlay, null);
  const why = transition(overlayState, { type: "OPEN_WHY" });
  assert.equal(why.overlay.type, "why", `why opens from ${phase}`);
}

const narrow = render(createPathfinderState(), { columns: 80, rows: 24 });
assert.ok(narrow.text.split("\n").length <= 24);
assert.ok(narrow.text.split("\n").every((line) => displayWidth(line) <= 80));
assert.match(narrow.text, /Phase 1\/5: Discover/);
assert.match(narrow.text, /Preview:/);
assert.match(narrow.text, /p full Preview/);
assert.equal(narrow.provider_calls, 0);
assert.match(stripAnsi(narrow.text), /┌ Discover/);

const noColor = render(createPathfinderState({ discovery }), { columns: 80, rows: 24, color: false });
assert.doesNotMatch(noColor.text, /\x1b\[/);
assert.ok(noColor.text.split("\n").every((line) => displayWidth(line) <= 80));
assert.doesNotMatch(render(createPathfinderState({ discovery }), { columns: 80, rows: 24 }).text, /\x1b\[/, "pure rendering defaults to redirected/no-color output");
assert.match(render(createPathfinderState({ discovery }), { columns: 80, rows: 24, color: true }).text, /\x1b\[/, "tests may explicitly force color");
const previousNoColor = process.env.NO_COLOR;
process.env.NO_COLOR = "";
assert.doesNotMatch(render(createPathfinderState({ discovery }), { columns: 80, rows: 24 }).text, /\x1b\[/);
if (previousNoColor === undefined) delete process.env.NO_COLOR;
else process.env.NO_COLOR = previousNoColor;

assert.equal(displayWidth("界"), 2, "CJK uses two terminal cells");
assert.equal(displayWidth("e\u0301"), 1, "combining graphemes use one terminal cell");
assert.equal(displayWidth("👩‍💻"), 2, "emoji ZWJ graphemes use two terminal cells");
assert.equal(displayWidth("🇲🇽"), 2, "regional-indicator emoji use two terminal cells");
assert.equal(displayWidth(clipAnsi("\x1b[32m界界界\x1b[0m", 5)), 5, "CJK clipping reserves a cell for the ellipsis");
assert.match(stripAnsi(clipAnsi("👩‍💻👩‍💻👩‍💻", 5)), /^👩‍💻👩‍💻…$/u, "clipping never splits an emoji ZWJ sequence");
const unicodeState = createPathfinderState({ current: { name: "開発e\u0301👩‍💻" }, discovery });
for (const columns of [20, 40, 80, 120]) {
  const unicodeRender = render(unicodeState, { columns, rows: 24, color: false });
  assert.ok(unicodeRender.text.split("\n").every((line) => displayWidth(line) <= columns), `Unicode borders fit ${columns} cells`);
}

let fullPreview = transition(createPathfinderState(), { type: "OPEN_PREVIEW" });
const firstPage = render(fullPreview, { columns: 80, rows: 24 });
assert.match(firstPage.text, /page 1\/2/);
fullPreview = transition(fullPreview, { type: "PAGE", delta: 1 });
assert.match(render(fullPreview, { columns: 80, rows: 24 }).text, /page 2\/2/);
for (let index = 0; index < 100; index += 1) fullPreview = transition(fullPreview, { type: "PAGE", delta: 1 });
assert.equal(fullPreview.overlay.page, 1, "preview page state is clamped at the final page");
for (let index = 0; index < 100; index += 1) fullPreview = transition(fullPreview, { type: "PAGE", delta: -1 });
assert.equal(fullPreview.overlay.page, 0, "preview page state is clamped at the first page");
let resizedPreview = transition(createPathfinderState(), { type: "OPEN_PREVIEW" });
resizedPreview = transition(resizedPreview, { type: "PAGE", delta: 100, pageSize: previewPageSize({ columns: 120, rows: 30 }) });
assert.equal(resizedPreview.overlay.page, 0, "wide viewport page bounds use the rendered page size");

const wide = render(createPathfinderState(), { columns: 120, rows: 30 });
assert.match(wide.text, /\[Discover\] > Choose > Configure > Review > Apply/);
assert.match(wide.text, /Why this recommendation/);
assert.ok(wide.text.split("\n").every((line) => displayWidth(line) <= 120));
assert.match(stripAnsi(wide.text), /┌ Discover/);
assert.match(stripAnsi(wide.text), /┌ Rationale/);

const tallWide = render(createPathfinderState(), { columns: 120, rows: 50, color: false });
assert.equal(tallWide.text.split("\n").length, 17, "short wide panels stay compact on tall terminals");
assert.match(tallWide.text, /└─+┘ └─+┘\nPhase 1\/5: Discover/, "footer follows the compact panels immediately");
const tallConfigure = render({ ...createPathfinderState({ discovery }), phase: "Configure" }, { columns: 120, rows: 50, color: false });
assert.equal(tallConfigure.text.split("\n").length, 17, "wide Configure does not add an empty boxed area");

for (const phase of PHASES) {
  const phaseState = { ...createPathfinderState({ discovery }), phase };
  const rendered = render(phaseState, { columns: 80, rows: 24, color: false });
  const lines = rendered.text.split("\n");
  assert.ok(lines.length <= 24, `${phase} does not overflow an 80x24 viewport`);
  assert.ok(lines.every((line) => displayWidth(line) <= 80), `${phase} preserves ANSI-aware width at 80 columns`);
  assert.match(lines.at(-1), /^Keys: p full Preview/, `${phase} footer is not clipped at 80x24`);
  assert.equal(rendered.hitRegions.length, controlsFor(phaseState).length, `${phase} keeps every active control visible at 80x24`);
  assert.ok(rendered.hitRegions.every(({ y1, y2 }) => y1 === y2 && y1 > 0 && y1 <= lines.length), `${phase} hit regions retain rendered y coordinates`);
}

for (const type of ["OPEN_PREVIEW", "OPEN_WHY"]) {
  const rendered = render(transition(createPathfinderState({ discovery }), { type }), { columns: 80, rows: 24, color: false });
  const lines = rendered.text.split("\n");
  assert.ok(lines.length <= 24 && lines.every((line) => displayWidth(line) <= 80), `${type} overlay fits 80x24`);
  assert.match(lines.at(-1), /^Keys: p full Preview/, `${type} overlay keeps its footer visible`);
}

const model = previewModel(discoveredRecommendation.decisions, discovery);
assert.equal(model.providerCalls, 0);
assert.match(model.lines.join("\n"), /Wildcard primary: ollama\/qwen2\.5-coder:7b/);
assert.match(model.lines.join("\n"), /Orchestrator override: anthropic\/claude-sonnet-4/);
assert.match(model.lines.join("\n"), /Developer override: anthropic\/claude-sonnet-4/);
assert.match(model.lines.join("\n"), /Global fallback chain: ollama\/qwen2\.5-coder:7b → anthropic\/claude-sonnet-4/);
const keepModel = previewModel(recommend({ discovery: existingDiscovery }).decisions, existingDiscovery);
assert.match(keepModel.lines.join("\n"), /remains untouched and was not read into the TUI/);
assert.doesNotMatch(keepModel.lines.join("\n"), /Wildcard primary|Global fallback chain|Model write approved/);
const laterDecisions = { ...discoveredRecommendation.decisions, modelStrategy: "configure-later" };
const laterModel = previewModel(laterDecisions, discovery);
assert.match(laterModel.lines.join("\n"), /No model configuration will be written/);
assert.doesNotMatch(laterModel.lines.join("\n"), /Wildcard primary|Global fallback chain|Model write approved/);

const codingConfigure = { ...createPathfinderState({ discovery }), phase: "Configure" };
assert.deepEqual(controlsFor(codingConfigure), ["models", "name", "path", "intent", "next"]);
assert.doesNotMatch(stripAnsi(render(codingConfigure, { columns: 100, rows: 30, color: false }).text), /Memory:/);
const memoryConfigure = { ...createPathfinderState({ current: { edition: "memory" }, discovery }), phase: "Configure" };
assert.deepEqual(controlsFor(memoryConfigure), ["memory", "name", "path", "intent", "next"]);
assert.doesNotMatch(stripAnsi(render(memoryConfigure, { columns: 100, rows: 30, color: false }).text), /Profiles:|Models:/);
const fullConfigure = { ...createPathfinderState({ current: { edition: "full" }, discovery }), phase: "Configure" };
assert.deepEqual(controlsFor(fullConfigure), ["memory", "models", "name", "path", "intent", "next"]);
for (const rendered of [render(codingConfigure, { color: false }), render(memoryConfigure, { color: false }), render(fullConfigure, { color: false })]) {
  assert.doesNotMatch(rendered.text, /not-needed-for-/);
}

let changed = createPathfinderState({ discovery });
changed = transition(changed, { type: "CUSTOMIZE" });
changed = transition(changed, { type: "PATCH", key: "edition", value: "full" });
changed = transition(changed, { type: "PATCH", key: "memorySetup", value: "postgres" });
changed = transition(changed, { type: "PATCH", key: "name", value: "changed-name" });
assert.match(rationaleLines(changed).join("\n"), /Edition: Full\. Changed from recommendation; your selection is respected\./);
assert.match(rationaleLines(changed).join("\n"), /Memory: Postgres\. Changed from recommendation; your selection is respected\./);
assert.match(rationaleLines(changed).join("\n"), /Install name: changed-name\. Changed from recommendation; your selection is respected\./);
assert.match(rationaleLines(changed).join("\n"), /Target path: ~\/\.alfred\/installs\/changed-name\./);
assert.doesNotMatch(rationaleLines(createPathfinderState()).join("\n"), /Target path: default\./, "empty path uses Preview's effective derived target");

let approved = createPathfinderState({ discovery });
approved = transition(approved, { type: "USE_RECOMMENDED" });
approved = transition(approved, { type: "PATCH", key: "applyIntent", value: "apply-safe-steps" });
approved = transition(approved, { type: "PATCH", key: "modelWriteApproved", value: true });
assert.equal(approved.decisions.modelWriteApproved, true);
approved = transition(approved, { type: "CONTINUE" });
approved = transition(approved, { type: "CONFIRM" });
assert.equal(approved.decisions.apply, true);
assert.match(serializeAssignments(approved.decisions, { reviewVisited: approved.reviewVisited }), /^MODEL_STRATEGY='smart-defaults'$/m);
assert.match(serializeAssignments(approved.decisions, { reviewVisited: approved.reviewVisited }), /^MODEL_WRITE_APPROVED='true'$/m);

let unreviewed = createPathfinderState({ discovery });
unreviewed = transition(unreviewed, { type: "PATCH", key: "modelWriteApproved", value: true });
assert.equal(unreviewed.decisions.modelWriteApproved, false, "approval is unavailable before Review");
assert.match(serializeAssignments({ ...discoveredRecommendation.decisions, apply: true, modelWriteApproved: true }), /^MODEL_WRITE_APPROVED='false'$/m);

const assignments = serializeAssignments({ ...explicit.decisions, apply: false });
for (const name of ["EDITION", "HARNESS", "PROFILE_STRATEGY", "MEMORY_SETUP", "NAME", "APPLY", "SKIP_PROFILE_MANAGER", "TUI_USED", "TUI_MODE", "MODEL_STRATEGY", "MODEL_WRITE_APPROVED", "TARGET_PATH"]) {
  assert.match(assignments, new RegExp(`^${name}=`, "m"));
}
assert.match(assignments, /^TUI_MODE='app'$/m);

const primaryPress = decodeTerminalEvent("\x1b[<0;12;8M");
assert.deepEqual(sgrMouseAction(primaryPress), { type: "activate", x: 12, y: 8 });
for (const sequence of ["\x1b[<0;12;8m", "\x1b[<1;12;8M", "\x1b[<2;12;8M", "\x1b[<4;12;8M", "\x1b[<8;12;8M", "\x1b[<16;12;8M", "\x1b[<32;12;8M"]) {
  assert.deepEqual(sgrMouseAction(decodeTerminalEvent(sequence), { overlayOpen: true }), { type: "ignore" }, `${JSON.stringify(sequence)} cannot activate`);
}
assert.deepEqual(sgrMouseAction(decodeTerminalEvent("\x1b[<64;12;8M"), { overlayOpen: true }), { type: "page", delta: -1 });
assert.deepEqual(sgrMouseAction(decodeTerminalEvent("\x1b[<65;12;8M"), { overlayOpen: true }), { type: "page", delta: 1 });
assert.deepEqual(sgrMouseAction(decodeTerminalEvent("\x1b[<64;12;8M")), { type: "ignore" });

for (const char of ["p", "w", "r", "b", "q"]) {
  const decoded = decodeTerminalEvent(char);
  assert.equal(decoded.type, "text");
  assert.deepEqual(printableInputAction(decoded.text, { textFieldFocused: true }), { type: "input", text: char });
}
assert.deepEqual(printableInputAction("p", { textFieldFocused: false }), { type: "token", token: "p" });
assert.deepEqual(printableInputAction("q", { textFieldFocused: false }), { type: "token", token: "cancel" });
assert.equal(decodeTerminalEvent("\x1b[200~").type, "ignore", "complete unsupported CSI is ignored");
assert.equal(decodeTerminalEvent("\x1b[20").type, "incomplete", "fragmented CSI waits for completion");
assert.equal(decodeTerminalEvent("\x1b[20" + "0~").type, "ignore", "completed CSI fragments are ignored as one sequence");
assert.equal(decodeTerminalEvent("\x1b]0;title\u0007").type, "ignore", "complete OSC is ignored");

console.log("install pathfinder tests ok");
