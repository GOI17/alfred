import fs from "node:fs";
import path from "node:path";
import { runPiRoadmapReadinessSpike } from "../packages/pi-adapter/src/runtime.js";

const root = process.cwd();
const traceOutputPath = path.join(root, ".ai/observability/generated/post-phase-7-roadmap-readiness.json");

function fail(message) {
  throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const requiredPaths = [
  ".ai/execution/post-phase-7-roadmap.json",
  ".ai/evals/baselines/post-phase-7-roadmap-readiness.json",
  ".ai/evals/suites/roadmap-readiness.yml",
  ".ai/evals/datasets/roadmap-readiness.yml",
  "packages/core/src/index.js",
  "packages/pi-adapter/src/runtime.js"
];

for (const relativePath of requiredPaths) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`Missing required roadmap file: ${relativePath}`);
}

const roadmap = readJson(".ai/execution/post-phase-7-roadmap.json");
const expectedPhases = [
  "phase-1-architecture-kernel",
  "phase-2-pi-runtime-spike",
  "phase-3-agent-system",
  "phase-4-security-enforcement",
  "phase-5-evals-regression-gates",
  "phase-6-skill-packs-lazy-loading",
  "phase-7-harness-portability"
];

if (roadmap.owner !== "core") fail("Roadmap must be owned by core");
if (roadmap.status !== "active") fail("Roadmap must be active after Phase 7");
for (const phase of expectedPhases) {
  if (!roadmap.completed_phases.includes(phase)) fail(`Roadmap omits completed phase: ${phase}`);
}
if (roadmap.completed_phases.length !== expectedPhases.length) fail("Roadmap must record exactly seven completed phases");
if (roadmap.release_readiness.provider_calls_allowed !== 0) fail("Roadmap readiness must be local-only");
if (roadmap.release_readiness.baseline_update_requires_human_approval !== true) {
  fail("Roadmap must preserve human approval for baseline updates");
}
if (roadmap.governance.issue_branch_pr_required !== true) fail("Roadmap must preserve issue -> branch -> PR governance");
if (roadmap.governance.direct_main_commits_allowed !== false) fail("Roadmap must reject direct main commits");
if (roadmap.next_milestones.length !== 3) fail("Roadmap must declare three concrete next milestones");

const result = runPiRoadmapReadinessSpike({ root, traceOutputPath });
if (result.orchestrator.id !== "orchestrator") fail("Roadmap readiness must run from Orchestrator context");
if (result.readiness.status !== "pass") fail("Roadmap readiness must pass");
if (result.readiness.completed_phase_count !== 7) fail("Roadmap readiness must evaluate seven completed phases");
if (result.readiness.next_milestone_count !== 3) fail("Roadmap readiness must evaluate three next milestones");
if (result.readiness.provider_calls !== 0) fail("Roadmap readiness must not call providers");

if (!fs.existsSync(traceOutputPath)) fail("Roadmap generated trace file was not written");
const trace = readJson(".ai/observability/generated/post-phase-7-roadmap-readiness.json");
if (trace.event !== "roadmap_readiness_evaluated") fail("Roadmap trace must be roadmap_readiness_evaluated");
if (trace.actor !== "pi-adapter") fail("Roadmap trace must be emitted by pi-adapter");
if (trace.data.provider_calls !== 0) fail("Roadmap trace must record zero provider calls");
if (trace.data.completed_phase_count !== 7) fail("Roadmap trace must record seven completed phases");
if (trace.data.next_milestone_count !== 3) fail("Roadmap trace must record three next milestones");

const baseline = readJson(".ai/evals/baselines/post-phase-7-roadmap-readiness.json");
if (baseline.result !== "pass") fail("Roadmap readiness baseline must pass");
if (baseline.completed_phase_count !== 7) fail("Roadmap baseline must record seven completed phases");
if (baseline.next_milestone_count !== 3) fail("Roadmap baseline must record three next milestones");
if (baseline.provider_calls !== 0) fail("Roadmap baseline must record zero provider calls");
if (!baseline.reproducibility?.runtime_entrypoint) fail("Roadmap baseline must include runtime entrypoint metadata");

const corePackage = readJson("packages/core/package.json");
if (corePackage.dependencies || corePackage.devDependencies) {
  fail("packages/core must remain dependency-free and harness-agnostic during roadmap readiness");
}

console.log("roadmap validation ok: post-Phase-7 readiness is explicit, local-only, and governance-preserving");
