import fs from "node:fs";
import path from "node:path";
import {
  createTraceEvent,
  evaluateMvpReleasePlan,
  loadMvpReleasePlan,
  loadRoadmap020,
  readJson
} from "../packages/core/src/index.js";

const root = process.cwd();
const traceOutputPath = path.join(root, ".ai/observability/generated/mvp-release-plan.json");

function fail(message) {
  throw new Error(message);
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporaryPath, filePath);
}

const requiredPaths = [
  ".ai/roadmaps/mvp-release.json",
  ".ai/roadmaps/mvp-release.md",
  ".ai/roadmaps/0.2.0.json",
  ".ai/evals/baselines/mvp-release-plan.json",
  ".ai/evals/suites/mvp-release-plan.yml",
  ".ai/evals/datasets/mvp-release-plan.yml",
  "packages/core/src/index.js"
];

for (const relativePath of requiredPaths) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`Missing required MVP release plan file: ${relativePath}`);
}

const plan = loadMvpReleasePlan(root);
const roadmap = loadRoadmap020(root);

if (plan.id !== "mvp-release-plan") fail("MVP plan id must be mvp-release-plan");
if (plan.status !== "active") fail("MVP plan must be active");
if (plan.target_release !== "0.2.0") fail("MVP target release must be 0.2.0");
if (plan.provider_calls_allowed !== 0) fail("MVP plan must be local-only");
if (plan.baseline_update_requires_human_approval !== true) fail("MVP plan must require approval for baseline updates");
if (plan.harness_config_writes_require_human_approval !== true) {
  fail("MVP plan must require approval before harness config writes");
}

const requiredHarnesses = ["vscode", "opencode", "pi"];
const previewHarnesses = ["claude", "codex", "kiro"];
for (const harness of requiredHarnesses) {
  if (!plan.required_harnesses?.includes(harness)) fail(`MVP plan must require ${harness}`);
}
for (const harness of previewHarnesses) {
  if (!plan.preview_harnesses?.includes(harness)) fail(`MVP plan must keep ${harness} as preview target`);
}
if (plan.required_harnesses.length !== requiredHarnesses.length) fail("MVP plan must have exactly three required harnesses");
if (plan.preview_harnesses.length !== previewHarnesses.length) fail("MVP plan must have exactly three preview harnesses");

const expectedPhases = ["phase-9-adapter-generation", "phase-10-eval-runner-cli", "phase-11-release-0.2.0"];
if (plan.phases.length !== expectedPhases.length) fail("MVP plan must contain exactly three phases");
for (const [index, phaseId] of expectedPhases.entries()) {
  const phase = plan.phases[index];
  if (phase.id !== phaseId) fail(`MVP plan phase ${index + 1} must be ${phaseId}`);
  if (phase.order !== index + 1) fail(`MVP plan phase ${phaseId} has wrong order`);
  if (phase.provider_calls_allowed !== 0) fail(`MVP plan phase ${phaseId} must be local-only`);
  if (!phase.acceptance_criteria?.length) fail(`MVP plan phase ${phaseId} needs acceptance criteria`);
  if (!phase.deliverables?.length) fail(`MVP plan phase ${phaseId} needs deliverables`);
  if (!phase.validation?.length) fail(`MVP plan phase ${phaseId} needs validation`);
}

if (plan.non_goals.length < 5) fail("MVP plan must document explicit non-goals");
if (plan.release_gates.length < 7) fail("MVP plan must document release gates");
const phase9 = plan.phases.find((phase) => phase.id === "phase-9-adapter-generation");
const phase9Text = `${phase9.goal} ${phase9.deliverables.join(" ")} ${phase9.acceptance_criteria.join(" ")}`.toLowerCase();
for (const harness of requiredHarnesses) {
  if (!phase9Text.includes(harness)) fail(`Phase 9 must explicitly prioritize ${harness}`);
}
const gatesText = plan.release_gates.join(" ").toLowerCase();
for (const harness of requiredHarnesses) {
  if (!gatesText.includes(harness)) fail(`MVP release gates must include required harness ${harness}`);
}

const evaluation = evaluateMvpReleasePlan({ plan, roadmap });
if (evaluation.status !== "pass") fail("MVP release plan evaluation must pass");
if (evaluation.provider_calls !== 0) fail("MVP release plan evaluation must record zero provider calls");
if (evaluation.phase_count !== 3) fail("MVP release plan evaluation must record three phases");
if (evaluation.missing_roadmap_phases.length !== 0) fail("MVP plan phases must align with roadmap 0.2.0");
if (evaluation.missing_required_harnesses.length !== 0) fail("MVP plan must include all required harnesses");
if (evaluation.preview_harness_conflicts.length !== 0) fail("Preview harnesses must not overlap required harnesses");
if (evaluation.phase9_missing_required_harnesses.length !== 0) fail("Phase 9 must include all required harnesses");

const trace = createTraceEvent({
  event: "mvp_release_plan_validated",
  actor: "orchestrator",
  data: {
    trace_id: "mvp-release-plan",
    timestamp: "2026-05-19T00:00:00.000Z",
    status: evaluation.status,
    plan_id: evaluation.plan_id,
    target_release: evaluation.target_release,
    phase_count: evaluation.phase_count,
    required_harnesses: evaluation.required_harnesses,
    preview_harnesses: evaluation.preview_harnesses,
    required_harness_count: evaluation.required_harness_count,
    preview_harness_count: evaluation.preview_harness_count,
    release_gate_count: evaluation.release_gate_count,
    non_goal_count: evaluation.non_goal_count,
    provider_calls: evaluation.provider_calls,
    plan: ".ai/roadmaps/mvp-release.json"
  }
});
writeJsonAtomic(traceOutputPath, trace);

const generatedTrace = readJson(root, ".ai/observability/generated/mvp-release-plan.json");
if (generatedTrace.event !== "mvp_release_plan_validated") fail("MVP release plan trace event is incorrect");
if (generatedTrace.data.provider_calls !== 0) fail("MVP release plan trace must record zero provider calls");
if (generatedTrace.data.phase_count !== 3) fail("MVP release plan trace must record three phases");
if (generatedTrace.data.required_harness_count !== 3) fail("MVP release plan trace must record three required harnesses");

const baseline = readJson(root, ".ai/evals/baselines/mvp-release-plan.json");
if (baseline.result !== "pass") fail("MVP release plan baseline must pass");
if (baseline.target_release !== "0.2.0") fail("MVP release plan baseline must target 0.2.0");
if (baseline.phase_count !== 3) fail("MVP release plan baseline must record three phases");
if (baseline.required_harness_count !== 3) fail("MVP release plan baseline must record three required harnesses");
if (baseline.preview_harness_count !== 3) fail("MVP release plan baseline must record three preview harnesses");
if (baseline.provider_calls !== 0) fail("MVP release plan baseline must record zero provider calls");
if (!baseline.reproducibility?.runtime_entrypoint) fail("MVP release plan baseline needs reproducibility metadata");

const corePackage = readJson(root, "packages/core/package.json");
if (corePackage.dependencies || corePackage.devDependencies) {
  fail("packages/core must remain dependency-free while planning MVP release");
}

console.log("mvp release plan validation ok: MVP scope, phases, non-goals, and gates are explicit and local-only");
