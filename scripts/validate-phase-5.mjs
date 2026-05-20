import fs from "node:fs";
import path from "node:path";
import { runPiEvalGateSpike } from "../packages/pi-adapter/src/runtime.js";

const root = process.cwd();
const traceOutputPath = path.join(root, ".ai/observability/generated/phase-5-regression-gate.json");

function fail(message) {
  throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const requiredPaths = [
  ".ai/evals/regression-gates.json",
  ".ai/evals/suites/regression-gates.yml",
  ".ai/evals/datasets/regression-gates.yml",
  ".ai/evals/baselines/phase-1-architecture-kernel.json",
  ".ai/evals/baselines/phase-2-pi-runtime-spike.json",
  ".ai/evals/baselines/phase-3-agent-system.json",
  ".ai/evals/baselines/phase-4-security-enforcement.json",
  ".ai/evals/baselines/phase-5-evals-regression-gates.json",
  ".ai/versions/locks.json",
  "packages/core/src/index.js",
  "packages/pi-adapter/src/runtime.js"
];

for (const relativePath of requiredPaths) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`Missing required Phase 5 file: ${relativePath}`);
}

const gatePolicy = readJson(".ai/evals/regression-gates.json");
if (gatePolicy.owner !== "core") fail("Phase 5 regression gates must be owned by core");
if (gatePolicy.baseline_update_requires_human_approval !== true) {
  fail("Phase 5 must require human approval for baseline updates");
}
if (gatePolicy.provider_calls_allowed !== 0) fail("Phase 5 regression gates must run local-only");
if (gatePolicy.phases.length !== 4) fail("Phase 5 must compare phases 1 through 4");

const locks = readJson(".ai/versions/locks.json");
if (locks.baseline_update_requires_human_approval !== true) fail("Version locks must protect baseline updates");
if (locks.baseline_update_policy?.allowed_by_agent !== false) fail("Agents must not update baselines autonomously");
for (const lock of ["agents", "skills", "permissions", "routing_policy", "regression_gates", "pi_adapter_runtime"]) {
  if (!locks.locks?.[lock]) fail(`Missing Phase 5 version lock: ${lock}`);
}

const result = runPiEvalGateSpike({ root, traceOutputPath });
if (result.gate.status !== "pass") fail("Phase 5 regression gate must pass");
if (result.gate.regressions.length !== 0) fail("Phase 5 must not report regressions");
if (result.gate.provider_calls !== 0) fail("Phase 5 must not call providers");
if (result.gate.comparisons.length !== 4) fail("Phase 5 must compare four prior phase baselines");
if (result.gate.baseline_update_requires_human_approval !== true) {
  fail("Phase 5 gate result must preserve baseline human-approval requirement");
}

const phase3 = result.current_results["phase-3-agent-system"];
if (phase3.small_task_delegations !== 0) fail("Phase 5 must catch small-task delegation regressions");
if (phase3.specialist_delegations < 1) fail("Phase 5 must preserve specialist delegation coverage");

const phase4 = result.current_results["phase-4-security-enforcement"];
if (phase4.denied_permissions < 4) fail("Phase 5 must preserve security denial coverage");
if (phase4.provider_calls !== 0) fail("Security gate comparison must remain local-only");

if (!fs.existsSync(traceOutputPath)) fail("Phase 5 generated trace file was not written");
const trace = readJson(".ai/observability/generated/phase-5-regression-gate.json");
if (trace.event !== "regression_gate_evaluated") fail("Phase 5 trace must be regression_gate_evaluated");
if (trace.data.status !== "pass") fail("Phase 5 trace must record pass status");
if (trace.data.provider_calls !== 0) fail("Phase 5 trace must record zero provider calls");
if (trace.data.regressions.length !== 0) fail("Phase 5 trace must record zero regressions");
if (trace.data.comparisons.length !== 4) fail("Phase 5 trace must include all comparisons");
if (trace.data.baseline_update_requires_human_approval !== true) {
  fail("Phase 5 trace must record baseline update human approval requirement");
}

const baseline = readJson(".ai/evals/baselines/phase-5-evals-regression-gates.json");
if (baseline.result !== "pass") fail("Phase 5 baseline must pass");
if (baseline.phases_compared !== 4) fail("Phase 5 baseline must record four compared phases");
if (baseline.regressions !== 0) fail("Phase 5 baseline must record zero regressions");
if (baseline.provider_calls !== 0) fail("Phase 5 baseline must record zero provider calls");
if (baseline.baseline_update_requires_human_approval !== true) {
  fail("Phase 5 baseline must record human approval for baseline updates");
}
if (!baseline.reproducibility?.runtime_entrypoint) fail("Phase 5 baseline must include runtime entrypoint metadata");

const corePackage = readJson("packages/core/package.json");
if (corePackage.dependencies || corePackage.devDependencies) {
  fail("packages/core must remain dependency-free and harness-agnostic during Phase 5");
}

console.log("phase 5 validation ok: evals, baseline comparison, regression gates, and version locks are deterministic");
