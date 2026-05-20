import fs from "node:fs";
import path from "node:path";
import { runPiAgentSystemSpike } from "../packages/pi-adapter/src/runtime.js";

const root = process.cwd();
const traceOutputPath = path.join(root, ".ai/observability/generated/phase-3-delegation-decision.json");

function fail(message) {
  throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const requiredPaths = [
  ".ai/agents/routing-policy.json",
  ".ai/evals/suites/agent-system.yml",
  ".ai/evals/datasets/agent-routing.yml",
  ".ai/evals/baselines/phase-3-agent-system.json",
  "packages/core/src/index.js",
  "packages/pi-adapter/src/runtime.js"
];

for (const relativePath of requiredPaths) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`Missing required Phase 3 file: ${relativePath}`);
}

const routingPolicy = readJson(".ai/agents/routing-policy.json");
if (routingPolicy.owner !== "core") fail("Phase 3 routing policy must be owned by core");
if (!routingPolicy.simple_task_indicators.includes("typo")) fail("Routing policy must include simple task indicators");
for (const id of ["developer", "qa", "librarian", "architect", "reviewer"]) {
  if (!routingPolicy.specialists.some((specialist) => specialist.id === id)) {
    fail(`Routing policy must include specialist ${id}`);
  }
}
if (routingPolicy.temporary_agent.promotion_requires_human_approval !== true) {
  fail("Temporary agent promotion must require human approval");
}

const result = runPiAgentSystemSpike({ root, traceOutputPath });
if (result.manifest_phase !== "phase-1-architecture-kernel") fail("Phase 3 must load the architecture kernel");
if (result.orchestrator.id !== "orchestrator") fail("Phase 3 must route through the orchestrator");
if (result.decisions.length !== 3) fail("Phase 3 spike must evaluate three routing scenarios");

const small = result.decisions.find((decision) => decision.scenario_id === "small-task-no-delegation");
if (!small) fail("Missing small task scenario");
if (small.task_classification.complexity !== "small") fail("Small task must classify as small");
if (small.delegation !== false) fail("Small task must not be delegated");
if (small.target_agent !== "orchestrator") fail("Small task must stay with orchestrator");
if (small.temporary_agent_proposal !== null) fail("Small task must not propose a temporary agent");

const qa = result.decisions.find((decision) => decision.scenario_id === "qa-specialist-delegation");
if (!qa) fail("Missing QA specialist scenario");
if (qa.task_classification.complexity !== "specialized") fail("QA task must classify as specialized");
if (qa.delegation !== true) fail("QA task must delegate");
if (qa.target_agent !== "qa") fail("QA task must select QA specialist");
if (qa.temporary_agent_proposal !== null) fail("QA task must not propose temporary agent");

const temporary = result.decisions.find((decision) => decision.scenario_id === "temporary-agent-proposal");
if (!temporary) fail("Missing temporary agent scenario");
if (temporary.task_classification.complexity !== "unknown-specialized") {
  fail("Missing-specialist task must classify as unknown-specialized");
}
if (temporary.delegation !== false) fail("Missing-specialist task must not delegate to a non-fitting specialist");
if (temporary.temporary_agent_proposal?.temporary_agent_proposed !== true) {
  fail("Missing-specialist task must propose a temporary agent");
}
if (temporary.temporary_agent_proposal?.human_approval_required !== true) {
  fail("Temporary agent proposal must require human approval");
}

if (!fs.existsSync(traceOutputPath)) fail("Phase 3 generated trace file was not written");
const trace = readJson(".ai/observability/generated/phase-3-delegation-decision.json");
if (trace.event !== "delegation_decision") fail("Phase 3 trace must be delegation_decision");
if (trace.data.provider_calls !== 0) fail("Phase 3 routing spike must not call providers");
if (trace.data.decisions.length !== 3) fail("Phase 3 trace must include all routing decisions");

const baseline = readJson(".ai/evals/baselines/phase-3-agent-system.json");
if (baseline.result !== "pass") fail("Phase 3 baseline must pass");
if (baseline.small_task_delegations !== 0) fail("Phase 3 baseline must record zero small-task delegations");
if (baseline.temporary_agent_proposals !== 1) fail("Phase 3 baseline must record one temporary agent proposal");
if (!baseline.reproducibility?.runtime_entrypoint) fail("Phase 3 baseline must include runtime entrypoint metadata");

const corePackage = readJson("packages/core/package.json");
if (corePackage.dependencies || corePackage.devDependencies) {
  fail("packages/core must remain dependency-free and harness-agnostic during Phase 3");
}

console.log("phase 3 validation ok: routing, specialist selection, and temporary proposal are deterministic");
