#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PHASES,
  MODEL_STRATEGIES,
  availableModelStrategies,
  buildCustomModelsConfig,
  canonicalModelsJson,
  abbreviateHomePath,
  clipAnsi,
  controlsFor,
  createPathfinderState,
  displayWidth,
  normalizeTuiLayout,
  normalizeDiscovery,
  modelPlanForState,
  modelPlanInspectionStatus,
  modelPlanReviewLines,
  previewModel,
  previewPageSize,
  recommend,
  render,
  rationaleLines,
  sanitizeTerminalOutput,
  sanitizeTerminalText,
  sanitizeModelInput,
  serializeAssignments,
  stripAnsi,
  terminalPhysicalRows,
  transition,
  validateCustomModelsDraft,
  wrapAnsi
} from "./install-pathfinder.mjs";
import {
  decodeTerminalEvent,
  inlineClearSequence,
  inlineFrameInfo,
  inlinePhysicalRows,
  inlineRedrawSequence,
  printableInputAction,
  terminalTokenAction,
  sgrMouseAction,
  writePrivateModelPlan
} from "./install-app.mjs";

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

let noSignalModels = { ...createPathfinderState(), phase: "Configure" };
assert.ok(MODEL_STRATEGIES.includes("custom-models"), "custom-models is a stable strategy");
assert.deepEqual(availableModelStrategies(noSignalModels), ["custom-models", "configure-later"], "manual model assignment remains available with zero detections");
noSignalModels = transition(noSignalModels, { type: "PATCH", key: "modelStrategy", value: "custom-models" });
noSignalModels = focusControl(noSignalModels, "models");
noSignalModels = transition(noSignalModels, { type: "ACTIVATE" });
assert.equal(noSignalModels.overlay?.type, "model-editor", "Enter opens the manual model editor");
noSignalModels = focusControl(noSignalModels, "model:wildcard");
noSignalModels = transition(noSignalModels, { type: "ACTIVATE" });
noSignalModels = transition(noSignalModels, { type: "INPUT", text: "ollama/qwen2.5-coder:7b" });
noSignalModels = transition(noSignalModels, { type: "ACTIVATE" });
assert.equal(noSignalModels.decisions.customModels.wildcard, "ollama/qwen2.5-coder:7b", "explicit edit mode commits the wildcard model ID");

const strategyMatrix = [
  [createPathfinderState(), ["custom-models", "configure-later"]],
  [createPathfinderState({ discovery }), ["smart-defaults", "custom-models", "configure-later"]],
  [createPathfinderState({ discovery: existingDiscovery }), ["keep-existing", "smart-defaults", "custom-models", "configure-later"]],
  [createPathfinderState({ current: { edition: "memory" }, discovery: existingDiscovery }), ["configure-later"]]
];
for (const [matrixState, expected] of strategyMatrix) assert.deepEqual(availableModelStrategies(matrixState), expected);

let editor = { ...createPathfinderState(), phase: "Configure" };
editor = transition(editor, { type: "PATCH", key: "modelStrategy", value: "custom-models" });
editor = transition(editor, { type: "PATCH", key: "modelWildcard", value: "a👩‍💻b" });
editor = focusControl(editor, "models");
editor = transition(editor, { type: "ACTIVATE" });
editor = focusControl(editor, "model:wildcard");
editor = transition(editor, { type: "ACTIVATE" });
editor = transition(editor, { type: "CHANGE", delta: -1 });
editor = transition(editor, { type: "BACKSPACE" });
assert.equal(editor.editing.draft, "ab", "Backspace removes one complete emoji grapheme");
editor = transition(editor, { type: "ESCAPE" });
assert.equal(editor.decisions.customModels.wildcard, "a👩‍💻b", "Escape cancels the active field draft");
editor = transition(editor, { type: "ACTIVATE" });
editor = transition(editor, { type: "CHANGE", delta: -1 });
editor = transition(editor, { type: "DELETE" });
editor = transition(editor, { type: "ACTIVATE" });
assert.equal(editor.decisions.customModels.wildcard, "a👩‍💻", "Delete removes the grapheme after the cursor and Enter commits");

editor = focusControl(editor, "fallback-add");
editor = transition(editor, { type: "ACTIVATE" });
editor = transition(editor, { type: "INPUT", text: "provider/first;$HOME" });
editor = transition(editor, { type: "ACTIVATE" });
editor = focusControl(editor, "fallback-add");
editor = transition(editor, { type: "ACTIVATE" });
editor = transition(editor, { type: "INPUT", text: "provider/second,opaque" });
editor = transition(editor, { type: "ACTIVATE" });
assert.deepEqual(editor.decisions.customModels.fallbacks, ["provider/first;$HOME", "provider/second,opaque"], "fallback IDs are independent opaque rows");
editor = focusControl(editor, "fallback-up");
editor = transition(editor, { type: "ACTIVATE" });
assert.deepEqual(editor.decisions.customModels.fallbacks, ["provider/second,opaque", "provider/first;$HOME"], "Move preserves explicit fallback order");
editor = focusControl(editor, "fallback-remove");
editor = transition(editor, { type: "ACTIVATE" });
assert.deepEqual(editor.decisions.customModels.fallbacks, ["provider/first;$HOME"], "Remove deletes only the selected fallback row");

const hostileRevision = editor.modelRevision;
const hostileModel = transition(editor, { type: "PATCH", key: "modelWildcard", value: "safe\x1b]52;c;evil\x07" });
assert.equal(hostileModel.modelRevision, hostileRevision, "hostile terminal controls are rejected before persistence");
assert.equal(hostileModel.decisions.customModels.wildcard, editor.decisions.customModels.wildcard);
assert.equal(sanitizeModelInput("model\nnext"), null);
assert.equal(sanitizeModelInput("provider/model;$HOME"), "provider/model;$HOME", "shell metacharacters remain opaque data");

assert.deepEqual(buildCustomModelsConfig({ wildcard: " provider/main ", orchestrator: "   ", developer: " provider/dev ", fallbacks: [" fallback/one "] }), {
  "*": { primary: " provider/main " }, developer: { primary: " provider/dev " }, fallbacks: [" fallback/one "]
});
assert.equal(validateCustomModelsDraft({ wildcard: "   ", orchestrator: "", developer: "", fallbacks: [] }).status, "fail", "required whitespace-only wildcard remains invalid");
assert.equal(validateCustomModelsDraft({ wildcard: " provider/main ", orchestrator: "   ", developer: "", fallbacks: [] }).status, "pass", "optional whitespace-only overrides are omitted without rewriting valid IDs");
assert.equal(validateCustomModelsDraft({ wildcard: "", orchestrator: "", developer: "", fallbacks: [] }).status, "fail");
assert.equal(validateCustomModelsDraft({ wildcard: "provider/main", orchestrator: "", developer: "", fallbacks: [""] }).status, "fail");
let invalidReview = { ...createPathfinderState(), phase: "Configure" };
invalidReview = transition(invalidReview, { type: "PATCH", key: "modelStrategy", value: "custom-models" });
invalidReview = transition(invalidReview, { type: "NEXT" });
invalidReview = focusControl(invalidReview, "model-approval");
assert.equal(transition(invalidReview, { type: "ACTIVATE" }).decisions.modelWriteApproved, false, "approval is unavailable for an invalid custom plan");
invalidReview = focusControl(invalidReview, "continue");
assert.equal(transition(invalidReview, { type: "ACTIVATE" }).phase, "Review", "invalid custom Review cannot continue");
const invalidApply = { ...invalidReview, phase: "Apply", reviewVisited: true };
assert.equal(transition(focusControl(invalidApply, "confirm"), { type: "ACTIVATE" }).done, false, "invalid custom Apply cannot confirm");

let revisionState = { ...createPathfinderState(), phase: "Configure" };
revisionState = transition(revisionState, { type: "PATCH", key: "modelStrategy", value: "custom-models" });
revisionState = transition(revisionState, { type: "PATCH", key: "modelWildcard", value: "provider/main;$(opaque)" });
revisionState = transition(revisionState, { type: "PATCH", key: "modelOrchestrator", value: "provider/orchestrator" });
revisionState = transition(revisionState, { type: "PATCH", key: "modelDeveloper", value: "provider/developer" });
revisionState = transition(revisionState, { type: "PATCH", key: "modelFallback", value: "provider/fallback-one" });
revisionState = transition(revisionState, { type: "NEXT" });
assert.equal(revisionState.reviewedModelRevision, revisionState.modelRevision, "Review binds to the current model revision");
revisionState = inspectExactPlan(revisionState);
revisionState = focusControl(revisionState, "model-approval");
revisionState = transition(revisionState, { type: "ACTIVATE" });
assert.equal(revisionState.decisions.modelWriteApproved, true);
revisionState = transition(revisionState, { type: "PATCH", key: "modelWildcard", value: "provider/changed" });
assert.equal(revisionState.decisions.modelWriteApproved, false, "any model edit clears approval");
assert.equal(revisionState.reviewedModelRevision, null, "any model edit invalidates Review binding");
assert.equal(transition(focusControl(revisionState, "continue"), { type: "ACTIVATE" }).phase, "Review", "stale Review cannot continue");

let approvedCustom = { ...revisionState, phase: "Configure" };
approvedCustom = transition(approvedCustom, { type: "NEXT" });
approvedCustom = inspectExactPlan(approvedCustom);
approvedCustom = focusControl(approvedCustom, "model-approval");
approvedCustom = transition(approvedCustom, { type: "ACTIVATE" });
approvedCustom = transition(approvedCustom, { type: "PATCH", key: "applyIntent", value: "apply-safe-steps" });
approvedCustom = focusControl(approvedCustom, "continue");
approvedCustom = transition(approvedCustom, { type: "ACTIVATE" });
approvedCustom = focusControl(approvedCustom, "confirm");
approvedCustom = transition(approvedCustom, { type: "ACTIVATE" });
const exactCustomPlan = modelPlanForState(approvedCustom);
assert.deepEqual(exactCustomPlan.models, {
  "*": { primary: "provider/changed" },
  orchestrator: { primary: "provider/orchestrator" },
  developer: { primary: "provider/developer" },
  fallbacks: ["provider/fallback-one"]
});
const customPreview = previewModel(approvedCustom.decisions, approvedCustom.discovery).lines.join("\n");
assert.match(customPreview, /Canonical models\.json: .*provider\/changed/);
const customAssignments = serializeAssignments(approvedCustom.decisions, approvedCustom);
assert.match(customAssignments, /^MODEL_STRATEGY='custom-models'$/m);
assert.match(customAssignments, /^MODEL_WRITE_APPROVED='true'$/m);
assert.doesNotMatch(customAssignments, /provider\/|model-plan|MODEL_PLAN|\$HOME/, "raw model IDs and plan paths never enter result IPC");
const expectedPlanDigest = "a".repeat(64);
const customDigestAssignments = serializeAssignments(approvedCustom.decisions, { ...approvedCustom, modelPlanSha256: expectedPlanDigest });
assert.match(customDigestAssignments, new RegExp(`^MODEL_PLAN_SHA256='${expectedPlanDigest}'$`, "m"), "approved custom output carries only the plan digest");
assert.match(serializeAssignments(approvedCustom.decisions, { ...approvedCustom, modelInspection: null, modelPlanSha256: expectedPlanDigest }), /^MODEL_WRITE_APPROVED='false'$/m, "serialization independently rejects approval when exact pages were omitted");
assert.equal(modelPlanForState({ ...approvedCustom, modelInspection: null }), null, "plan creation independently rejects omitted exact-page inspection");
assert.throws(() => serializeAssignments(approvedCustom.decisions, { ...approvedCustom, modelPlanSha256: "ABC" }), /model plan digest/, "TUI refuses malformed digest IPC");
assert.doesNotMatch(serializeAssignments({ ...discoveredRecommendation.decisions, apply: true, modelWriteApproved: true }, { reviewVisited: true, modelPlanSha256: expectedPlanDigest }), /MODEL_PLAN_SHA256/, "non-custom output cannot carry a plan digest");

let inspectedPlan = { ...createPathfinderState(), phase: "Configure" };
inspectedPlan = transition(inspectedPlan, { type: "PATCH", key: "modelStrategy", value: "custom-models" });
inspectedPlan = transition(inspectedPlan, { type: "PATCH", key: "modelWildcard", value: " provider/main " });
for (let index = 1; index <= 12; index += 1) inspectedPlan = transition(inspectedPlan, { type: "PATCH", key: "modelFallback", value: ` provider/fallback-${index} ` });
inspectedPlan = transition(inspectedPlan, { type: "NEXT" });
assert.match(render(inspectedPlan, { columns: 80, rows: 24, color: false }).text, /Inspect exact models\.json.*not inspected/, "custom Review visibly requires exact inspection");
assert.equal(modelPlanInspectionStatus(inspectedPlan).label, "not inspected");
inspectedPlan = focusControl(inspectedPlan, "model-plan-review");
inspectedPlan = transition(inspectedPlan, { type: "ACTIVATE" });
assert.equal(inspectedPlan.overlay?.type, "model-plan-review");
inspectedPlan = transition(inspectedPlan, { type: "PAGE", delta: 0, pageSize: 5 });
const canonicalInspection = canonicalModelsJson(inspectedPlan.decisions.customModels);
assert.equal(canonicalInspection, `${JSON.stringify(buildCustomModelsConfig(inspectedPlan.decisions.customModels), null, 2)}\n`, "inspection uses exact canonical target bytes");
assert.equal(modelPlanReviewLines(inspectedPlan, 10).join(""), canonicalInspection.replaceAll("\n", ""), "wrapping exact JSON never drops ordinary spaces or punctuation");
assert.match(previewModel(inspectedPlan.decisions, inspectedPlan.discovery).lines.join("\n"), /"primary":" provider\/main "/, "preview JSON preserves ordinary leading and trailing model-ID spaces");
assert.ok(modelPlanInspectionStatus(inspectedPlan).totalPages >= 3, "10+ fallbacks paginate at 80x24-sized content");
inspectedPlan = transition(inspectedPlan, { type: "CLOSE_OVERLAY" });
assert.match(modelPlanInspectionStatus(inspectedPlan).label, /^pages 1\//);
inspectedPlan = focusControl(inspectedPlan, "model-approval");
assert.equal(transition(inspectedPlan, { type: "ACTIVATE" }).decisions.modelWriteApproved, false, "approval is unavailable after viewing only one page");
inspectedPlan = focusControl(inspectedPlan, "continue");
assert.equal(transition(inspectedPlan, { type: "ACTIVATE" }).phase, "Review", "Continue is blocked before every exact page and approval");
inspectedPlan = focusControl(inspectedPlan, "model-plan-review");
inspectedPlan = transition(inspectedPlan, { type: "ACTIVATE" });
for (let page = 1; page < modelPlanInspectionStatus(inspectedPlan).totalPages; page += 1) inspectedPlan = transition(inspectedPlan, { type: "PAGE", delta: 1, pageSize: 5 });
assert.equal(modelPlanInspectionStatus(inspectedPlan).label, "inspected", "all exact pages viewed marks the current revision inspected");
inspectedPlan = transition(inspectedPlan, { type: "CLOSE_OVERLAY" });
inspectedPlan = focusControl(inspectedPlan, "continue");
assert.equal(transition(inspectedPlan, { type: "ACTIVATE" }).phase, "Review", "fully inspected custom Review still requires explicit approval");
inspectedPlan = focusControl(inspectedPlan, "model-approval");
inspectedPlan = transition(inspectedPlan, { type: "ACTIVATE" });
assert.equal(inspectedPlan.decisions.modelWriteApproved, true);
inspectedPlan = focusControl(inspectedPlan, "continue");
assert.equal(transition(inspectedPlan, { type: "ACTIVATE" }).phase, "Apply");
const inspectedRevision = inspectedPlan.modelRevision;
inspectedPlan = transition(inspectedPlan, { type: "PATCH", key: "modelDeveloper", value: " provider/changed " });
assert.equal(inspectedPlan.modelRevision, inspectedRevision + 1);
assert.equal(inspectedPlan.decisions.modelWriteApproved, false, "model edits clear explicit approval");
assert.equal(modelPlanInspectionStatus(inspectedPlan).label, "not inspected", "model edits clear exact-page inspection");

let renderedInspection = { ...inspectedPlan, phase: "Review" };
renderedInspection = transition(renderedInspection, { type: "PATCH", key: "modelDeveloper", value: "" });
renderedInspection = focusControl(renderedInspection, "model-plan-review");
renderedInspection = transition(renderedInspection, { type: "ACTIVATE" });
const inspectionPageSize = previewPageSize({ columns: 80, rows: 24 });
const inspectionLines = modelPlanReviewLines(renderedInspection, 78);
renderedInspection = transition(renderedInspection, { type: "PAGE", delta: 0, pageSize: inspectionPageSize, totalItems: inspectionLines.length });
let renderedExactPages = "";
for (let page = 0; page < modelPlanInspectionStatus(renderedInspection).totalPages; page += 1) {
  renderedExactPages += `${render(renderedInspection, { columns: 80, rows: 24, color: false }).text}\n`;
  if (page + 1 < modelPlanInspectionStatus(renderedInspection).totalPages) renderedInspection = transition(renderedInspection, { type: "PAGE", delta: 1, pageSize: inspectionPageSize, totalItems: inspectionLines.length });
}
for (let index = 1; index <= 12; index += 1) assert.match(renderedExactPages, new RegExp(`provider/fallback-${index}`), `80x24 exact review renders fallback ${index} on some inspected page`);

for (const layout of ["fullscreen", "inline"]) {
  let reachable = { ...editor, editing: null };
  for (let index = 0; index < controlsFor(reachable).length; index += 1) {
    reachable = { ...reachable, focus: index };
    const rendered = render(reachable, { columns: 80, rows: 24, color: false, layout });
    assert.ok(rendered.text.split("\n").length <= (layout === "fullscreen" ? 23 : 24), `${layout} model editor fits 80x24`);
    assert.ok(rendered.hitRegions.some(({ action }) => action.control === controlsFor(reachable)[index]), `${layout} model editor keeps focused control reachable`);
  }
}

const planWriterFixture = mkdtempSync(join(tmpdir(), "alfred-model-plan-writer-"));
try {
  const planPath = join(planWriterFixture, "model-plan.json");
  writeFileSync(planPath, "", { mode: 0o600 });
  const written = writePrivateModelPlan(planPath, exactCustomPlan);
  assert.deepEqual(JSON.parse(readFileSync(planPath, "utf8")), exactCustomPlan);
  assert.equal(written.sha256, createHash("sha256").update(readFileSync(planPath)).digest("hex"), "writer hashes the exact bytes renamed into place");
  assert.deepEqual(written.bytes, readFileSync(planPath), "writer returns the exact atomically written bytes");
  assert.equal(statSync(planPath).mode & 0o777, 0o600);
  assert.deepEqual(readFileSync(planPath, "utf8").includes("provider/changed"), true);
  assert.deepEqual(readdirSync(planWriterFixture), ["model-plan.json"], "atomic plan write leaves no sibling temp file");
} finally {
  rmSync(planWriterFixture, { recursive: true, force: true });
}

const unsafePlanWriterFixture = mkdtempSync(join(tmpdir(), "alfred-model-plan-writer-unsafe-"));
try {
  const wrongName = join(unsafePlanWriterFixture, "other.json");
  writeFileSync(wrongName, "", { mode: 0o600 });
  assert.throws(() => writePrivateModelPlan(wrongName, exactCustomPlan), /fixed model-plan\.json filename/);
  const outside = join(unsafePlanWriterFixture, "outside.json");
  const symlinkPlan = join(unsafePlanWriterFixture, "model-plan.json");
  writeFileSync(outside, "outside", { mode: 0o600 });
  symlinkSync(outside, symlinkPlan);
  assert.throws(() => writePrivateModelPlan(symlinkPlan, exactCustomPlan), /regular non-symlink/);
  rmSync(symlinkPlan);
  writeFileSync(symlinkPlan, "", { mode: 0o644 });
  assert.throws(() => writePrivateModelPlan(symlinkPlan, exactCustomPlan), /mode 0600/);
  chmodSync(symlinkPlan, 0o600);
  chmodSync(unsafePlanWriterFixture, 0o755);
  assert.throws(() => writePrivateModelPlan(symlinkPlan, exactCustomPlan), /private mode 0700/);
} finally {
  chmodSync(unsafePlanWriterFixture, 0o700);
  rmSync(unsafePlanWriterFixture, { recursive: true, force: true });
}

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

function focusControl(state, control) {
  return transition(state, { type: "FOCUS_CONTROL", control });
}

function inspectExactPlan(state, pageSize = 5) {
  let inspected = focusControl(state, "model-plan-review");
  inspected = transition(inspected, { type: "ACTIVATE" });
  inspected = transition(inspected, { type: "PAGE", delta: 0, pageSize });
  for (let page = 1; page < modelPlanInspectionStatus(inspected).totalPages; page += 1) inspected = transition(inspected, { type: "PAGE", delta: 1, pageSize });
  return transition(inspected, { type: "CLOSE_OVERLAY" });
}

for (const [control, activatedPhase] of [["recommended", "Review"], ["customize", "Choose"]]) {
  const discoverAction = focusControl(createPathfinderState(), control);
  const decisionsBefore = structuredClone(discoverAction.decisions);
  for (const delta of [-1, 1]) {
    const changedDiscoverAction = transition(discoverAction, { type: "CHANGE", delta });
    assert.equal(changedDiscoverAction.phase, "Discover", `${control} ignores horizontal arrows`);
    assert.deepEqual(changedDiscoverAction.decisions, decisionsBefore, `${control} horizontal arrows do not mutate decisions`);
  }
  assert.equal(transition(discoverAction, { type: "ACTIVATE" }).phase, activatedPhase, `Enter activates ${control}`);
}

const harnessAction = focusControl(transition(createPathfinderState(), { type: "CUSTOMIZE" }), "harness:opencode");
for (const delta of [-1, 1]) {
  assert.deepEqual(
    transition(harnessAction, { type: "CHANGE", delta }).decisions.selectedHarnesses,
    harnessAction.decisions.selectedHarnesses,
    "horizontal arrows never toggle harness selection"
  );
}
assert.deepEqual(transition(harnessAction, { type: "SPACE" }).decisions.selectedHarnesses, ["opencode"], "Space toggles a harness");
assert.deepEqual(transition(harnessAction, { type: "ACTIVATE" }).decisions.selectedHarnesses, ["opencode"], "Enter toggles a harness");

const chooseEnums = transition(createPathfinderState({ discovery }), { type: "CUSTOMIZE" });
const enumCases = [
  { control: "edition", key: "edition", state: chooseEnums },
  { control: "profile", key: "profileStrategy", state: chooseEnums },
  { control: "memory", key: "memorySetup", state: { ...createPathfinderState({ current: { edition: "full" }, discovery }), phase: "Configure" } },
  { control: "models", key: "modelStrategy", state: { ...createPathfinderState({ discovery }), phase: "Configure" } },
  { control: "intent", key: "applyIntent", state: { ...createPathfinderState({ discovery }), phase: "Configure" } }
];
for (const { control, key, state: enumState } of enumCases) {
  const focused = focusControl(enumState, control);
  const initial = focused.decisions[key];
  const left = transition(focused, { type: "CHANGE", delta: -1 });
  const right = transition(focused, { type: "CHANGE", delta: 1 });
  assert.notEqual(left.decisions[key], initial, `Left cycles ${control}`);
  assert.notEqual(right.decisions[key], initial, `Right cycles ${control}`);
  assert.equal(transition(focused, { type: "ACTIVATE" }).decisions[key], initial, `Enter does not cycle ${control}`);
  assert.equal(transition(focused, { type: "SPACE" }).decisions[key], right.decisions[key], `Space cycles ${control} forward`);
}

const chooseNext = focusControl(chooseEnums, "next");
assert.equal(transition(chooseNext, { type: "CHANGE", delta: 1 }).phase, "Choose", "Right does not activate Choose Next");
assert.equal(transition(chooseNext, { type: "ACTIVATE" }).phase, "Configure", "Enter activates Choose Next");
const configureNext = focusControl({ ...createPathfinderState({ discovery }), phase: "Configure" }, "next");
assert.equal(transition(configureNext, { type: "CHANGE", delta: -1 }).phase, "Configure", "Left does not activate Configure Continue");
assert.equal(transition(configureNext, { type: "ACTIVATE" }).phase, "Review", "Enter activates Configure Continue");
const reviewContinue = focusControl(transition(createPathfinderState({ discovery }), { type: "USE_RECOMMENDED" }), "continue");
assert.equal(transition(reviewContinue, { type: "CHANGE", delta: 1 }).phase, "Review", "Right does not activate Review Continue");
assert.equal(transition(reviewContinue, { type: "ACTIVATE" }).phase, "Apply", "Enter activates Review Continue");
const applyConfirm = focusControl(transition(reviewContinue, { type: "ACTIVATE" }), "confirm");
assert.equal(transition(applyConfirm, { type: "CHANGE", delta: -1 }).done, false, "Left does not confirm Apply");
assert.equal(transition(applyConfirm, { type: "ACTIVATE" }).done, true, "Enter confirms Apply");

const modelApproval = focusControl(transition(createPathfinderState({ discovery }), { type: "USE_RECOMMENDED" }), "model-approval");
for (const delta of [-1, 1]) {
  assert.equal(transition(modelApproval, { type: "CHANGE", delta }).decisions.modelWriteApproved, false, "horizontal arrows do not toggle model approval");
}
assert.equal(transition(modelApproval, { type: "SPACE" }).decisions.modelWriteApproved, true, "Space toggles model approval");
assert.equal(transition(modelApproval, { type: "ACTIVATE" }).decisions.modelWriteApproved, true, "Enter toggles model approval");

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
assert.ok(narrow.text.split("\n").length <= 23);
assert.ok(narrow.text.split("\n").every((line) => displayWidth(line) <= 80));
assert.match(narrow.text, /Phase 1\/5: Discover/);
assert.match(narrow.text, /Preview:/);
assert.match(narrow.text, /p full/);
assert.match(narrow.text, /layout: fullscreen/);
assert.equal(narrow.text.match(/^Keys:/gm)?.length, 1, "the footer has one compact help line");
assert.equal(narrow.text.split("\n").length, 23, "fullscreen reserves the physical last row");
assert.match(narrow.text.split("\n").at(-1), /^Keys:/, "fullscreen help ends at physical row rows-1");
assert.match(narrow.text, /Provider\/model suggestions: no safe local signals detected/);
assert.equal(narrow.provider_calls, 0);
assert.match(stripAnsi(narrow.text), /┌ Discover/);

const noColor = render(createPathfinderState({ discovery }), { columns: 80, rows: 24, color: false });
assert.doesNotMatch(noColor.text, /\x1b\[/);
assert.ok(noColor.text.split("\n").every((line) => displayWidth(line) <= 80));
assert.match(noColor.text, /Existing install: found at ~\/\.alfred\/installs\/acme/, "install paths under home use ~/ in discovery");
const homePathDiscovery = normalizeDiscovery({
  ...discovery,
  git: {
    ...discovery.git,
    workspace_root: "/home/test/projects/alfred-linked",
    project_root: "/home/test/projects/alfred"
  }
});
const homePathRender = stripAnsi(render(createPathfinderState({ discovery: homePathDiscovery }), { columns: 80, rows: 24 }).text);
assert.match(homePathRender, /Git: repository · linked-worktree · ~\/projects\/alfred-linked/);
assert.match(homePathRender, /Project root: ~\/projects\/alfred/);
assert.equal(abbreviateHomePath("/home/tester/project", discovery), "/home/tester/project", "home abbreviation respects path boundaries");
assert.equal(abbreviateHomePath("/home/test\\projects\\alfred", discovery), "~/projects/alfred", "displayed home paths consistently use ~/ separators");
assert.doesNotMatch(render(createPathfinderState({ discovery }), { columns: 80, rows: 24 }).text, /\x1b\[/, "pure rendering defaults to redirected/no-color output");
assert.match(render(createPathfinderState({ discovery }), { columns: 80, rows: 24, color: true }).text, /\x1b\[/, "tests may explicitly force color");

const terminalAttacks = {
  osc52: "\x1b]52;c;ZXZpbA==\x07",
  oscTitle: "\x1b]0;injected title\x1b\\",
  dcs: "\x1bP1;2|injected dcs\x1b\\",
  sos: "\x1bXinjected sos\x1b\\",
  pm: "\x1b^injected pm\x1b\\",
  apc: "\x1b_injected apc\x1b\\",
  singleEsc: "\x1b7",
  c1Csi: "\x9b31m",
  c1Osc: "\x9d0;injected c1 title\x9c"
};
const injectedDiscovery = normalizeDiscovery({
  ...discovery,
  os: {
    platform: `lin${terminalAttacks.oscTitle}ux`,
    release: `6${terminalAttacks.dcs}.1\tstable`,
    architecture: `arm${terminalAttacks.c1Csi}64`
  },
  node: { ...discovery.node, version: `v24\r\nnext\b${terminalAttacks.c1Osc}` },
  models: {
    ...discovery.models,
    suggestions: [{
      provider: `ol${terminalAttacks.osc52}lama`,
      model: `ollama/qwen${terminalAttacks.dcs}\t2.5`,
      source: `socket:/tmp/model${terminalAttacks.oscTitle}.sock`
    }],
    proposed_config: {
      "*": { primary: `ollama/${terminalAttacks.c1Csi}qwen`, fallbacks: [`fallback${terminalAttacks.osc52}/one`] },
      orchestrator: { primary: `orchestrator${terminalAttacks.c1Osc}/model` },
      developer: { primary: `developer${terminalAttacks.dcs}/model` },
      fallbacks: [`fallback${terminalAttacks.oscTitle}/one`]
    }
  },
  install: {
    ...discovery.install,
    selected_target: `/tmp/install${terminalAttacks.osc52}\nnext`,
    models_config_path: `/tmp/models${terminalAttacks.dcs}.json`
  },
  git: {
    ...discovery.git,
    workspace_root: `/tmp/work${terminalAttacks.c1Osc}\tspace`,
    project_root: `/tmp/project${terminalAttacks.oscTitle}\rroot`
  }
});
assert.equal(sanitizeTerminalText(`a\tb\r\nc\bd${terminalAttacks.osc52}e`), "a b cde", "external spacing controls become spaces and other controls disappear");
for (const family of ["osc52", "oscTitle", "dcs", "sos", "pm", "apc", "singleEsc", "c1Csi", "c1Osc"]) {
  assert.equal(sanitizeTerminalText(`before${terminalAttacks[family]}after`), "beforeafter", `${family} terminal controls are removed completely`);
}
for (const c1String of ["\x90c1 dcs\x9c", "\x98c1 sos\x9c", "\x9ec1 pm\x9c", "\x9fc1 apc\x9c"]) {
  assert.equal(sanitizeTerminalText(`before${c1String}after`), "beforeafter", "C1 control strings are removed through ST");
}
assert.equal(sanitizeTerminalText("a\x00\x08\x7f\x80\x85\x9cb"), "a b", "remaining C0/C1 controls and DEL are removed while NEL becomes a space");
const allTerminalAttacks = Object.values(terminalAttacks).join("");
assert.equal(stripAnsi(`\x1b[32mbefore${allTerminalAttacks}after\x1b[0m`), "beforeafter", "strip helpers remove every control family including SGR");
assert.equal(displayWidth(`\x1b[32mbefore${allTerminalAttacks}after\x1b[0m`), "beforeafter".length, "measurement ignores every terminal control family");
assert.equal(sanitizeTerminalOutput(`\x1b[32mbefore${terminalAttacks.osc52}after\x1b[0m`), "\x1b[32mbeforeafter\x1b[0m", "output sanitization preserves Alfred SGR while removing string controls");
for (const sgr of ["\x1b[m", "\x1b[0m", "\x1b[36m", "\x1b[1;36m", "\x1b[38;5;36m"]) {
  assert.equal(sanitizeTerminalOutput(`before${sgr}after`), `before${sgr}after`, `${JSON.stringify(sgr)} strict numeric SGR is preserved`);
}
const unsafeSgrLookalikes = {
  privateGreater: "\x1b[>4;2m",
  privateQuestion: "\x1b[?1m",
  privateLess: "\x1b[<1m",
  privateEquals: "\x1b[=1m",
  colonSubparameters: "\x1b[38:5:36m",
  spaceIntermediate: "\x1b[31 m",
  dollarIntermediate: "\x1b[31$m",
  leadingEmptyParameter: "\x1b[;31m",
  internalEmptyParameter: "\x1b[31;;1m",
  trailingEmptyParameter: "\x1b[31;m",
  c1Sgr: "\x9b31m"
};
for (const [name, sequence] of Object.entries(unsafeSgrLookalikes)) {
  assert.equal(sanitizeTerminalOutput(`before${sequence}after`), "beforeafter", `${name} is removed even with an m final byte`);
}
assert.deepEqual(injectedDiscovery.models.suggestions, [{ provider: "ollama", model: "ollama/qwen 2.5", source: "socket:/tmp/model.sock" }]);
assert.equal(injectedDiscovery.models.proposed_config["*"].primary, "ollama/qwen");

function assertSafeRenderedControls(text, message) {
  const withoutAlfredSgr = String(text).replace(/\x1b\[(?:0|2|31|32|33|36)m/g, "");
  assert.doesNotMatch(withoutAlfredSgr, /[\x00-\x09\x0b-\x1f\x7f-\x9f]/u, message);
}

let injectedState = createPathfinderState({
  current: { name: `cur${terminalAttacks.osc52}\nname`, targetPath: `/tmp/current${terminalAttacks.dcs}\tpath` },
  discovery: injectedDiscovery
});
injectedState = transition(injectedState, { type: "CUSTOMIZE" });
injectedState = transition(injectedState, { type: "NEXT" });
assert.equal(injectedState.decisions.name, "cur name", "current install names are normalized before rendering");
assert.equal(injectedState.decisions.targetPath, "/tmp/current path", "current install paths are normalized before rendering");
assertSafeRenderedControls(render(injectedState, { columns: 80, rows: 24, color: true, layout: "inline" }).text, "current name/path controls are removed");
injectedState = transition(injectedState, { type: "PATCH", key: "name", value: `edited${terminalAttacks.oscTitle}\r\nname\b` });
injectedState = transition(injectedState, { type: "PATCH", key: "path", value: `/tmp/edited${terminalAttacks.c1Osc}\tpath` });
for (const phase of PHASES) {
  for (const layout of ["fullscreen", "inline"]) {
    for (const color of [false, true]) {
      const injectedRender = render({ ...injectedState, phase }, { columns: 120, rows: 30, color, layout });
      assertSafeRenderedControls(injectedRender.text, `${layout} ${phase} removes injected terminal controls`);
      assert.ok(injectedRender.text.split("\n").length <= (layout === "fullscreen" ? 29 : 30), `${layout} ${phase} injected values cannot add lines`);
      assert.ok(injectedRender.text.split("\n").every((line) => displayWidth(line) <= (layout === "inline" ? 119 : 120)), `${layout} ${phase} injected values preserve width bounds`);
    }
  }
}
for (const overlayType of ["OPEN_PREVIEW", "OPEN_WHY"]) {
  const injectedOverlay = render(transition({ ...injectedState, phase: "Review" }, { type: overlayType }), { columns: 80, rows: 24, color: true, layout: "inline" });
  assertSafeRenderedControls(injectedOverlay.text, `${overlayType} removes controls from preview/rationale interpolation`);
  assert.ok(injectedOverlay.text.split("\n").length <= 24, `${overlayType} injected values cannot add lines`);
}
const previousNoColor = process.env.NO_COLOR;
process.env.NO_COLOR = "";
assert.doesNotMatch(render(createPathfinderState({ discovery }), { columns: 80, rows: 24 }).text, /\x1b\[/);
if (previousNoColor === undefined) delete process.env.NO_COLOR;
else process.env.NO_COLOR = previousNoColor;

assert.equal(displayWidth("界"), 2, "CJK uses two terminal cells");
assert.equal(displayWidth("e\u0301"), 1, "combining graphemes use one terminal cell");
assert.equal(displayWidth("👩‍💻"), 2, "emoji ZWJ graphemes use two terminal cells");
assert.equal(displayWidth("🇲🇽"), 2, "regional-indicator emoji use two terminal cells");
assert.equal(terminalPhysicalRows("界界界", 3), 3, "wide graphemes move intact to the next physical row");
assert.notEqual(terminalPhysicalRows("界界界", 3), Math.ceil(displayWidth("界界界") / 3), "physical placement is not aggregate cell division");
assert.equal(terminalPhysicalRows("\x1b[32m界界界\x1b[0m", 3), 3, "ANSI does not consume terminal cells");
assert.equal(terminalPhysicalRows("👩‍💻👩‍💻👩‍💻", 3), 3, "emoji ZWJ graphemes do not straddle physical rows");
assert.equal(terminalPhysicalRows("e\u0301e\u0301e\u0301", 2), 2, "combining graphemes use the same width as displayWidth");
assert.equal(terminalPhysicalRows("界", 1), 2, "a grapheme wider than the viewport is counted conservatively");
assert.equal(terminalPhysicalRows("界", 0), 0, "unknown zero-width viewports do not claim terminal rows");
assert.equal(terminalPhysicalRows("界", -1), 0, "invalid negative-width viewports do not claim terminal rows");
assert.equal(displayWidth(clipAnsi("\x1b[32m界界界\x1b[0m", 5)), 5, "CJK clipping reserves a cell for the ellipsis");
assert.match(stripAnsi(clipAnsi("👩‍💻👩‍💻👩‍💻", 5)), /^👩‍💻👩‍💻…$/u, "clipping never splits an emoji ZWJ sequence");
const wrappedAnsi = wrapAnsi("\x1b[32mReadable rationale with 界 and 👩‍💻 stays colored across rows.\x1b[0m", 20);
assert.ok(wrappedAnsi.length > 1, "long rationale wraps to multiple rows");
assert.ok(wrappedAnsi.every((line) => displayWidth(line) <= 20), "wrapped rationale uses terminal cell width");
assert.ok(wrappedAnsi.every((line) => /\x1b\[32m/.test(line)), "wrapped rationale preserves color on continuation rows");
assert.doesNotMatch(wrappedAnsi.join("\n"), /…/, "wrapping does not replace rationale with clipped ellipses");
assert.equal(stripAnsi(wrappedAnsi.join(" ")), "Readable rationale with 界 and 👩‍💻 stays colored across rows.");
assert.ok(wrapAnsi("\x1b[0;33mCombined reset and color stays yellow across wrapped rows.\x1b[0m", 12).every((line) => /\x1b\[33m/.test(line)));
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
const tallWideLines = tallWide.text.split("\n");
assert.equal(tallWideLines.length, 49, "tall fullscreen rendering reserves one safe terminal row");
assert.match(tallWideLines.at(-3), /^Phase 1\/5: Discover/, "status is in the bottom footer region");
assert.match(tallWideLines.at(-2), /^Preview:/, "preview is in the bottom footer region");
assert.match(tallWideLines.at(-1), /^Keys:/, "help occupies the final owned row, not the physical last row");
const finalPanelBorder = tallWideLines.findLastIndex((line) => /└─+┘/.test(line));
assert.ok(finalPanelBorder > 0 && finalPanelBorder < tallWideLines.length - 4, "compact panels remain at the top with blank space before the footer");
const tallConfigure = render({ ...createPathfinderState({ discovery }), phase: "Configure" }, { columns: 120, rows: 50, color: false });
assert.equal(tallConfigure.text.split("\n").length, 49);
assert.ok(tallConfigure.text.split("\n").findLastIndex((line) => /└─+┘/.test(line)) < 45, "wide Configure does not add an empty boxed area");

let longRationaleState = createPathfinderState();
longRationaleState = transition(longRationaleState, { type: "PATCH", key: "name", value: "a-very-long-install-name-that-makes-the-recommendation-rationale-readable-across-lines" });
const longWideRationale = stripAnsi(render(longRationaleState, { columns: 120, rows: 50, color: true }).text);
assert.match(longWideRationale, /from recommendation; your selection is/);
assert.match(longWideRationale, /selection is respected\./);
assert.doesNotMatch(longWideRationale, /…/, "wide two-column rationale wraps without clipping");
const longOverlayRationale = stripAnsi(render(transition(longRationaleState, { type: "OPEN_WHY" }), { columns: 80, rows: 24, color: true }).text);
assert.match(longOverlayRationale, /Changed from recommendation; your selection is/);
assert.match(longOverlayRationale, /selection is respected\./);
assert.doesNotMatch(longOverlayRationale, /…/, "rationale overlay wraps without clipping");

for (const layout of ["fullscreen", "inline"]) {
  for (const phase of PHASES) {
    const phaseState = { ...createPathfinderState({ discovery }), phase };
    const rendered = render(phaseState, { columns: 80, rows: 24, color: false, layout });
    const lines = rendered.text.split("\n");
    const maximumRows = layout === "fullscreen" ? 23 : 24;
    const maximumWidth = layout === "inline" ? 79 : 80;
    assert.ok(lines.length <= maximumRows, `${layout} ${phase} fits an 80x24 viewport`);
    assert.ok(lines.every((line) => displayWidth(line) <= maximumWidth), `${layout} ${phase} preserves a non-wrapping ANSI-aware width at 80 columns`);
    assert.match(lines.at(-1), /^Keys:/, `${layout} ${phase} footer is not clipped at 80x24`);
    if (!phaseState.overlay) {
      assert.match(lines.at(-1), /←→ edit/, `${layout} ${phase} footer identifies horizontal editing`);
      assert.match(lines.at(-1), /Space toggle/, `${layout} ${phase} footer identifies Space toggling`);
      assert.match(lines.at(-1), /Enter select/, `${layout} ${phase} footer identifies Enter selection`);
    }
    assert.match(lines.at(-3), new RegExp(`layout: ${layout}`), `${layout} ${phase} identifies its layout`);
    assert.equal(rendered.text.match(/^Keys:/gm)?.length, 1, `${layout} ${phase} has one Keys line`);
    assert.equal(rendered.hitRegions.length, controlsFor(phaseState).length, `${layout} ${phase} keeps every active control visible at 80x24`);
    assert.ok(rendered.hitRegions.every(({ y1, y2 }) => y1 <= y2 && y1 > 0 && y2 <= lines.length), `${layout} ${phase} hit regions retain rendered y coordinates`);
    if (layout === "inline") assert.equal(lines.findLastIndex((line) => /└─+┘/.test(line)) + 4, lines.length, `${phase} inline footer immediately follows its natural panel height`);
  }

  for (const phase of PHASES) {
    for (const type of ["OPEN_PREVIEW", "OPEN_WHY"]) {
      const rendered = render(transition({ ...createPathfinderState({ discovery }), phase }, { type }), { columns: 80, rows: 24, color: false, layout });
      const lines = rendered.text.split("\n");
      const maximumRows = layout === "fullscreen" ? 23 : 24;
      const maximumWidth = layout === "inline" ? 79 : 80;
      assert.ok(lines.length <= maximumRows && lines.every((line) => displayWidth(line) <= maximumWidth), `${layout} ${phase} ${type} overlay fits 80x24 without autowrap`);
      assert.match(lines.at(-1), /^Keys: Esc close;arrows page/, `${layout} ${phase} ${type} overlay keeps its specific footer visible`);
      assert.equal(rendered.text.match(/^Keys:/gm)?.length, 1, `${layout} ${phase} ${type} overlay has one Keys line`);
      if (layout === "inline") assert.equal(lines.findLastIndex((line) => /└─+┘/.test(line)) + 4, lines.length, `${phase} ${type} inline footer immediately follows its natural panel height`);
    }
  }
}

for (const [columns, rows] of [[1, 1], [19, 2], [5, 5], [10, 4], [19, 7]]) {
  for (const layout of ["fullscreen", "inline"]) {
    const rendered = render(createPathfinderState({ discovery }), { columns, rows, color: true, layout });
    const lines = rendered.text === "" ? [] : rendered.text.split("\n");
    const widthLimit = layout === "inline" ? Math.max(0, columns - 1) : columns;
    const rowLimit = layout === "fullscreen" ? Math.max(0, rows - 1) : rows;
    assert.ok(lines.length <= rowLimit, `${layout} ${columns}x${rows} stays within actual rows`);
    assert.ok(lines.every((line) => displayWidth(line) <= widthLimit), `${layout} ${columns}x${rows} stays within its safe actual width`);
    assert.doesNotThrow(() => render(createPathfinderState(), { columns, rows, layout }), `${layout} ${columns}x${rows} rendering is total`);
    if (widthLimit > 0 && rowLimit > 0) assert.ok(lines.length > 0, `${layout} ${columns}x${rows} renders a clipped resize status`);
    if (columns >= 19) assert.match(stripAnsi(rendered.text), /Resize terminal/, `${layout} ${columns}x${rows} names the recovery action`);
  }
}
for (const layout of ["fullscreen", "inline"]) {
  assert.doesNotThrow(() => render(createPathfinderState(), { columns: 0, rows: 0, layout }));
  assert.equal(render(createPathfinderState(), { columns: 0, rows: 0, layout }).text, "");
}
assert.equal(render(createPathfinderState(), { columns: 80, rows: 1, layout: "fullscreen" }).text, "", "one-row fullscreen owns no rows");
assert.equal(render(createPathfinderState(), { columns: 80, rows: 0, layout: "fullscreen" }).text, "", "zero-row fullscreen owns no rows");

const inlineNatural = render(createPathfinderState(), { columns: 80, rows: 24, color: false, layout: "inline" });
const inlineNaturalLines = inlineNatural.text.split("\n");
const inlinePanelEnd = inlineNaturalLines.findLastIndex((line) => /└─+┘/.test(line));
assert.equal(inlineNaturalLines.length, inlinePanelEnd + 4, "inline status, preview, and help immediately follow the natural panel height");
assert.ok(inlineNaturalLines.length < 24, "inline Discover has no viewport filler");
assert.ok(inlineNaturalLines.every((line) => line.length > 0), "inline natural content contains no filler rows");
assert.equal(normalizeTuiLayout("inline"), "inline");
assert.equal(normalizeTuiLayout("fullscreen"), "fullscreen");
assert.equal(normalizeTuiLayout("invented"), "fullscreen", "unknown layouts safely normalize to fullscreen");

const previousWideFrame = inlineFrameInfo("\x1b[32m123456789012345678901234567890123456789\x1b[0m\n12345678901234567890\nshort", { columns: 80, rows: 24 });
assert.deepEqual(previousWideFrame.logicalLines.map(({ text }) => text), ["123456789012345678901234567890123456789", "12345678901234567890", "short"], "inline ownership stores ANSI-stripped logical lines");
assert.equal(previousWideFrame.columns, 80, "inline ownership stores prior geometry");
assert.equal(inlinePhysicalRows(previousWideFrame, 10), 7, "narrowing accounts for every reflowed physical row");
const shorterRedraw = inlineRedrawSequence("new one\nnew two", previousWideFrame, 10);
assert.equal(shorterRedraw.match(/\x1b\[2K/g)?.length, 7, "inline redraw erases every reflowed prior row when content shrinks");
assert.match(shorterRedraw, /^\r\x1b\[6A\x1b\[2Knew one\r\n/, "inline redraw starts at the true first reflowed row");
assert.match(shorterRedraw, /\r\x1b\[5A$/, "inline redraw returns to the new final owned row after clearing stale rows");
assert.doesNotMatch(shorterRedraw, /\x1b\[(?:H|2J|[0-9]+[BCD])/, "inline redraw uses only cursor-up and erase-line CSI operations");
const narrowFrame = inlineFrameInfo("123456789\nabcdefghi\nxyz", { columns: 10, rows: 8 });
assert.equal(inlinePhysicalRows(narrowFrame, 80), 3, "widening contracts ownership to the reflowed logical row count");
const widerRedraw = inlineRedrawSequence("one", narrowFrame, 80);
assert.equal(widerRedraw.match(/\x1b\[2K/g)?.length, 3, "widening and a shorter render erase only currently owned physical rows");
const inlineClear = inlineClearSequence(previousWideFrame, 10);
assert.equal(inlineClear.match(/\x1b\[2K/g)?.length, 7);
assert.match(inlineClear, /^\r\x1b\[6A/, "inline cleanup starts at the true reflowed frame start");
assert.match(inlineClear, /\r\x1b\[6A$/, "inline cleanup leaves the cursor at the owned frame start without entering history");
assert.doesNotMatch(inlineClear, /\x1b\[(?:H|2J|[0-9]+[BCD])/, "inline cleanup does not address rows outside its owned region");
const cjkFrame = inlineFrameInfo("\x1b[36m界界界\x1b[0m", { columns: 80, rows: 24 });
assert.equal(inlinePhysicalRows(cjkFrame, 3), 3, "inline ownership reuses grapheme-aware terminal placement");
const cjkRedraw = inlineRedrawSequence("ok", cjkFrame, 3);
assert.match(cjkRedraw, /^\r\x1b\[2A/, "redraw cursor-up count follows physical CJK placement, not aggregate width");
assert.equal(cjkRedraw.match(/\x1b\[2K/g)?.length, 3, "redraw erases all physically placed CJK rows");
const cjkClear = inlineClearSequence(cjkFrame, 3);
assert.match(cjkClear, /^\r\x1b\[2A/, "cleanup cursor-up count follows physical CJK placement");
assert.equal(inlinePhysicalRows(inlineFrameInfo("👩‍💻👩‍💻👩‍💻"), 3), 3, "inline ownership preserves emoji ZWJ graphemes");
assert.equal(inlinePhysicalRows(inlineFrameInfo("e\u0301e\u0301e\u0301"), 2), 2, "inline ownership preserves combining graphemes");
const injectedFrameText = `12345${terminalAttacks.osc52}6789\tX\nabc${terminalAttacks.dcs}def\b${terminalAttacks.c1Csi}`;
const sanitizedFrameText = sanitizeTerminalOutput(injectedFrameText);
assert.equal(sanitizedFrameText, "123456789 X\nabcdef", "frame sanitization preserves only visible line content");
assert.equal(terminalPhysicalRows(injectedFrameText, 10), terminalPhysicalRows(sanitizedFrameText, 10), "physical row measurement defensively matches emitted sanitized text");
const injectedFrame = inlineFrameInfo(injectedFrameText, { columns: 10, rows: 8 });
assert.equal(injectedFrame.text, sanitizedFrameText, "inline ownership stores exactly the visible sanitized text");
assert.equal(inlinePhysicalRows(injectedFrame, 10), 3, "inline ownership counts sanitized wrapping and logical lines");
const injectedRedraw = inlineRedrawSequence(`new${terminalAttacks.oscTitle}\tvalue${terminalAttacks.c1Osc}`, injectedFrame, 10);
assert.equal(injectedRedraw.match(/\x1b\[2K/g)?.length, 3, "redraw erase count matches sanitized prior physical rows");
assert.match(injectedRedraw, /new value/, "redraw emits normalized visible content");
assert.doesNotMatch(injectedRedraw, /\x1b\]|\x1b[PX^_]|[\x90\x98\x9b\x9d\x9e\x9f]/u, "redraw never emits injected terminal-control families");
assert.doesNotMatch(injectedRedraw, /injected title|injected dcs|injected c1 title|\t|\x08/, "redraw omits injected payloads and cursor-moving spacing controls");
for (const [name, sequence] of Object.entries(unsafeSgrLookalikes)) {
  const redraw = inlineRedrawSequence(`before${sequence}after`);
  assert.equal(redraw, "beforeafter", `inline redraw removes ${name}`);
}

const model = previewModel(discoveredRecommendation.decisions, discovery);
assert.equal(model.providerCalls, 0);
assert.match(model.lines.join("\n"), /Wildcard primary: ollama\/qwen2\.5-coder:7b/);
assert.match(model.lines.join("\n"), /Orchestrator override: anthropic\/claude-sonnet-4/);
assert.match(model.lines.join("\n"), /Developer override: anthropic\/claude-sonnet-4/);
assert.match(model.lines.join("\n"), /Global fallback chain: ollama\/qwen2\.5-coder:7b → anthropic\/claude-sonnet-4/);
const exactPathPreview = previewModel({ ...discoveredRecommendation.decisions, targetPath: "/home/test/.alfred/installs/exact-preview-path" }, discovery);
assert.match(exactPathPreview.lines.join("\n"), /Target path: \/home\/test\/\.alfred\/installs\/exact-preview-path/, "full Preview preserves the exact target path");
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

const longApprovalDiscovery = normalizeDiscovery({
  ...discovery,
  install: {
    ...discovery.install,
    models_config_path: "/home/test/.alfred/configuration/with/a/long/path/that/wraps/models.json"
  }
});
const longApprovalState = transition(createPathfinderState({ discovery: longApprovalDiscovery }), { type: "USE_RECOMMENDED" });
const longApprovalRender = render(longApprovalState, { columns: 80, rows: 24, color: false });
const approvalRegion = longApprovalRender.hitRegions.find(({ action }) => action.type === "PATCH" && action.key === "modelWriteApproved");
assert.ok(approvalRegion && approvalRegion.y2 > approvalRegion.y1, "a wrapped actionable row retains one multi-row mouse hit region");
assert.equal(longApprovalRender.hitRegions.length, controlsFor(longApprovalState).length, "wrapped actions preserve every Review control hit region");

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
const routingEditor = { overlay: { type: "model-editor" }, editing: null };
assert.deepEqual(terminalTokenAction(routingEditor, "up", 8), { type: "MOVE", delta: -1 }, "model editor Up routes to field movement");
assert.deepEqual(terminalTokenAction(routingEditor, "down", 8), { type: "MOVE", delta: 1 }, "model editor Down routes to field movement");
assert.deepEqual(terminalTokenAction(routingEditor, "left", 8), { type: "CHANGE", delta: -1 }, "model editor Left routes to the focused editor control");
assert.deepEqual(terminalTokenAction({ ...routingEditor, editing: { draft: "ab", cursor: 2 } }, "right", 8), { type: "CHANGE", delta: 1 }, "model editor Right routes to the grapheme cursor while editing");
for (const type of ["why", "preview", "model-plan-review"]) {
  assert.deepEqual(terminalTokenAction({ overlay: { type } }, "down", 8), { type: "PAGE", delta: 1, pageSize: 8 }, `${type} Down paginates`);
}
assert.deepEqual(terminalTokenAction({ ...routingEditor, editing: { draft: "changed" } }, "esc", 8), { type: "ESCAPE" }, "Escape cancels an active edit first");
assert.deepEqual(terminalTokenAction(routingEditor, "esc", 8), { type: "CLOSE_OVERLAY" }, "Escape closes the model editor only after editing ends");
assert.equal(decodeTerminalEvent("\x1b[200~").type, "ignore", "complete unsupported CSI is ignored");
assert.deepEqual(decodeTerminalEvent("\x1b[3~"), { type: "token", token: "delete", length: 4 });
assert.equal(decodeTerminalEvent("\x1b[20").type, "incomplete", "fragmented CSI waits for completion");
assert.equal(decodeTerminalEvent("\x1b[20" + "0~").type, "ignore", "completed CSI fragments are ignored as one sequence");
assert.equal(decodeTerminalEvent("\x1b]0;title\u0007").type, "ignore", "complete OSC is ignored");

console.log("install pathfinder tests ok");
