import fs from "node:fs";
import path from "node:path";
import { createTraceEvent, evaluateRoadmap020, loadRoadmap020, readJson } from "../packages/core/src/index.js";

const root = process.cwd();
const traceOutputPath = path.join(root, ".ai/observability/generated/roadmap-0.2.0.json");

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
  ".ai/roadmaps/0.2.0.json",
  ".ai/roadmaps/0.2.0.md",
  ".ai/evals/baselines/roadmap-0.2.0.json",
  ".ai/evals/suites/roadmap-0.2.0.yml",
  ".ai/evals/datasets/roadmap-0.2.0.yml",
  ".ai/releases/release-0.1.0.json",
  "packages/core/src/index.js"
];

for (const relativePath of requiredPaths) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`Missing required 0.2.0 roadmap file: ${relativePath}`);
}

const roadmap = loadRoadmap020(root);
if (roadmap.id !== "roadmap-0.2.0") fail("0.2.0 roadmap id is incorrect");
if (roadmap.status !== "active") fail("0.2.0 roadmap must be active");
if (roadmap.release_target !== "0.2.0") fail("0.2.0 roadmap release target is incorrect");
if (roadmap.previous_release !== "release-0.1.0") fail("0.2.0 roadmap must follow release-0.1.0");
if (roadmap.constraints.provider_calls_allowed !== 0) fail("0.2.0 roadmap validation must be local-only");
if (roadmap.constraints.core_harness_agnostic !== true) fail("0.2.0 roadmap must preserve core harness agnosticism");
if (roadmap.constraints.permission_escalation_requires_human_approval !== true) {
  fail("0.2.0 roadmap must preserve human approval for permission escalation");
}
if (roadmap.constraints.harness_config_writes_require_human_approval !== true) {
  fail("0.2.0 roadmap must preserve human approval for harness config writes");
}

const expectedPhases = [
  "phase-8-runtime-hardening",
  "phase-9-adapter-generation",
  "phase-10-eval-runner-cli",
  "phase-11-release-0.2.0"
];
if (roadmap.phases.length !== expectedPhases.length) fail("0.2.0 roadmap must define four phases");
for (const [index, phaseId] of expectedPhases.entries()) {
  const phase = roadmap.phases[index];
  if (phase.id !== phaseId) fail(`0.2.0 roadmap phase ${index + 1} must be ${phaseId}`);
  if (phase.order !== index + 1) fail(`${phaseId} order is incorrect`);
  if (phase.provider_calls_allowed !== 0) fail(`${phaseId} must be local-only`);
  if (!phase.validation?.length) fail(`${phaseId} must declare validation`);
}

const release = readJson(root, ".ai/releases/release-0.1.0.json");
if (release.status !== "complete") fail("0.2.0 roadmap requires release-0.1.0 to be complete");

const evaluation = evaluateRoadmap020({ roadmap });
if (evaluation.status !== "pass") fail("0.2.0 roadmap evaluation must pass");
if (evaluation.provider_calls !== 0) fail("0.2.0 roadmap evaluation must avoid providers");
if (evaluation.phase_count !== 4) fail("0.2.0 roadmap evaluation must record four phases");

const trace = createTraceEvent({
  event: "roadmap_0_2_0_validated",
  actor: "orchestrator",
  data: {
    trace_id: "roadmap-0.2.0",
    timestamp: "2026-05-19T00:00:00.000Z",
    status: evaluation.status,
    roadmap_id: evaluation.roadmap_id,
    version: evaluation.version,
    phase_count: evaluation.phase_count,
    first_phase: roadmap.phases[0].id,
    final_phase: roadmap.phases[roadmap.phases.length - 1].id,
    provider_calls: evaluation.provider_calls,
    roadmap: ".ai/roadmaps/0.2.0.json"
  }
});
writeJsonAtomic(traceOutputPath, trace);

const generatedTrace = readJson(root, ".ai/observability/generated/roadmap-0.2.0.json");
if (generatedTrace.event !== "roadmap_0_2_0_validated") fail("0.2.0 roadmap trace event is incorrect");
if (generatedTrace.data.provider_calls !== 0) fail("0.2.0 roadmap trace must record zero provider calls");
if (generatedTrace.data.phase_count !== 4) fail("0.2.0 roadmap trace must record four phases");

const baseline = readJson(root, ".ai/evals/baselines/roadmap-0.2.0.json");
if (baseline.result !== "pass") fail("0.2.0 roadmap baseline must pass");
if (baseline.phase_count !== 4) fail("0.2.0 roadmap baseline must record four phases");
if (baseline.provider_calls !== 0) fail("0.2.0 roadmap baseline must record zero provider calls");
if (!baseline.reproducibility?.runtime_entrypoint) fail("0.2.0 roadmap baseline must include reproducibility metadata");

const corePackage = readJson(root, "packages/core/package.json");
if (corePackage.dependencies || corePackage.devDependencies) {
  fail("packages/core must remain dependency-free and harness-agnostic during 0.2.0 roadmap validation");
}

console.log("roadmap 0.2.0 validation ok: next phases are ordered, local-only, and release-ready");
