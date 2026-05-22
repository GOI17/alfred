import fs from "node:fs";
import path from "node:path";
import {
  createTraceEvent,
  evaluateRuntimeHardening,
  loadRuntimeHardeningContract,
  readJson
} from "../packages/core/src/index.js";
import { buildPiStableRuntime } from "../packages/pi-adapter/src/runtime.js";
import { buildOpencodeStableRuntime } from "../packages/opencode-adapter/src/runtime.js";

const root = process.cwd();
const traceOutputPath = path.join(root, ".ai/observability/generated/phase-8-runtime-hardening.json");

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
  ".ai/runtime/phase-8-runtime-hardening.json",
  ".ai/execution/phase-8-runtime-hardening.json",
  ".ai/execution/phase-8-runtime-hardening.md",
  ".ai/evals/baselines/phase-8-runtime-hardening.json",
  ".ai/evals/suites/phase-8-runtime-hardening.yml",
  ".ai/evals/datasets/phase-8-runtime-hardening.yml",
  "packages/core/src/index.js",
  "packages/pi-adapter/src/runtime.js",
  "packages/opencode-adapter/src/runtime.js"
];

for (const relativePath of requiredPaths) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`Missing required Phase 8 file: ${relativePath}`);
}

const contract = loadRuntimeHardeningContract(root);
if (contract.id !== "phase-8-runtime-hardening") fail("Phase 8 contract id is incorrect");
if (contract.status !== "complete") fail("Phase 8 contract must be complete");
if (contract.owner !== "architect") fail("Phase 8 contract must be architect-owned");
if (contract.provider_calls_allowed !== 0) fail("Phase 8 must be local-only");
if (contract.human_approval_required_before_harness_config_write !== true) {
  fail("Phase 8 must require human approval before harness config writes");
}
if (contract.executable_adapters.length !== 2) fail("Phase 8 must cover Pi and opencode executable adapters");
for (const harness of ["pi", "opencode"]) {
  if (!contract.executable_adapters.includes(harness)) fail(`Phase 8 contract must include ${harness}`);
}

const adapters = [buildPiStableRuntime({ root }), buildOpencodeStableRuntime({ root })];
const evaluation = evaluateRuntimeHardening({ contract, adapters });
if (evaluation.status !== "pass") fail("Phase 8 runtime hardening evaluation must pass");
if (evaluation.stable_adapter_count !== 2) fail("Phase 8 must stabilize two adapters");
if (evaluation.provider_calls !== 0) fail("Phase 8 must avoid providers");
if (evaluation.capability_failures.length !== 0) fail("Phase 8 capabilities must all pass");
if (evaluation.trace_failures.length !== 0) fail("Phase 8 trace contracts must all pass");
if (evaluation.boundary_failures.length !== 0) fail("Phase 8 adapter boundaries must all pass");

for (const adapter of adapters) {
  if (adapter.status !== "stable") fail(`${adapter.harness} runtime must be stable`);
  if (adapter.provider_calls !== 0) fail(`${adapter.harness} runtime must avoid providers`);
  if (!adapter.runtime_api) fail(`${adapter.harness} runtime must expose a stable API id`);
  if (adapter.boundaries.core_is_harness_agnostic !== true) fail(`${adapter.harness} must preserve core agnosticism`);
  if (adapter.boundaries.harness_config_writes_disabled_by_default !== true) {
    fail(`${adapter.harness} must keep harness config writes disabled by default`);
  }
}

const trace = createTraceEvent({
  event: "runtime_hardening_evaluated",
  actor: "architect",
  data: {
    trace_id: "phase-8-runtime-hardening",
    timestamp: "2026-05-19T00:00:00.000Z",
    status: evaluation.status,
    runtime_contract: evaluation.runtime_contract,
    stable_adapter_count: evaluation.stable_adapter_count,
    executable_adapter_count: evaluation.executable_adapter_count,
    capability_failures: evaluation.capability_failures,
    trace_failures: evaluation.trace_failures,
    boundary_failures: evaluation.boundary_failures,
    provider_calls: evaluation.provider_calls,
    contract: ".ai/runtime/phase-8-runtime-hardening.json"
  }
});
writeJsonAtomic(traceOutputPath, trace);

const generatedTrace = readJson(root, ".ai/observability/generated/phase-8-runtime-hardening.json");
if (generatedTrace.event !== "runtime_hardening_evaluated") fail("Phase 8 trace event is incorrect");
if (generatedTrace.data.status !== "pass") fail("Phase 8 trace must pass");
if (generatedTrace.data.provider_calls !== 0) fail("Phase 8 trace must record zero provider calls");
if (generatedTrace.data.stable_adapter_count !== 2) fail("Phase 8 trace must record two stable adapters");

const baseline = readJson(root, ".ai/evals/baselines/phase-8-runtime-hardening.json");
if (baseline.result !== "pass") fail("Phase 8 baseline must pass");
if (baseline.stable_adapter_count !== 2) fail("Phase 8 baseline must record two stable adapters");
if (baseline.provider_calls !== 0) fail("Phase 8 baseline must record zero provider calls");
if (!baseline.reproducibility?.runtime_entrypoint) fail("Phase 8 baseline must include reproducibility metadata");

const corePackage = readJson(root, "packages/core/package.json");
if (corePackage.dependencies || corePackage.devDependencies) {
  fail("packages/core must remain dependency-free and harness-agnostic during Phase 8");
}

const coreSource = fs.readFileSync(path.join(root, "packages/core/src/index.js"), "utf8");
if (coreSource.includes("pi-adapter") || coreSource.includes("opencode-adapter")) {
  fail("packages/core must not import adapter packages");
}

console.log("phase 8 validation ok: runtime APIs are stable, local-only, and core-agnostic");
