import fs from "node:fs";
import path from "node:path";
import {
  createTraceEvent,
  evaluateAdapterHardening,
  loadAdapterHardeningContract,
  readJson
} from "../packages/core/src/index.js";
import { buildPiAdapterReadiness } from "../packages/pi-adapter/src/runtime.js";
import { buildOpencodeAdapterReadiness } from "../packages/opencode-adapter/src/runtime.js";

const root = process.cwd();
const traceOutputPath = path.join(root, ".ai/observability/generated/adapter-hardening.json");

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
  ".ai/harnesses/adapter-hardening.json",
  ".ai/execution/adapter-hardening.json",
  ".ai/evals/baselines/adapter-hardening.json",
  ".ai/evals/suites/adapter-hardening.yml",
  ".ai/evals/datasets/adapter-hardening.yml",
  "packages/pi-adapter/src/runtime.js",
  "packages/opencode-adapter/src/runtime.js",
  "packages/core/src/index.js"
];

for (const relativePath of requiredPaths) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`Missing required adapter hardening file: ${relativePath}`);
}

const contract = loadAdapterHardeningContract(root);
if (contract.owner !== "architect") fail("Adapter hardening contract must be architect-owned");
if (contract.status !== "complete") fail("Adapter hardening contract must be complete");
if (contract.provider_calls_allowed !== 0) fail("Adapter hardening must be local-only");
if (contract.executable_adapters.length !== 2) fail("Adapter hardening must cover exactly two executable adapters");
for (const harness of ["pi", "opencode"]) {
  if (!contract.executable_adapters.includes(harness)) fail(`Adapter hardening must include ${harness}`);
}
if (contract.artifact_policy.writes_harness_config_by_default !== false) {
  fail("Adapters must not write harness config by default");
}
if (contract.artifact_policy.human_approval_required_before_config_write !== true) {
  fail("Adapters must require human approval before harness config writes");
}

const readiness = [buildPiAdapterReadiness({ root }), buildOpencodeAdapterReadiness({ root })];
const evaluation = evaluateAdapterHardening({ contract, readiness });
if (evaluation.status !== "pass") fail("Adapter hardening evaluation must pass");
if (evaluation.provider_calls !== 0) fail("Adapter hardening evaluation must avoid providers");
if (evaluation.hardened_adapter_count !== 2) fail("Adapter hardening must harden Pi and opencode");
if (evaluation.invariant_failures.length !== 0) fail("Adapter hardening invariants must all pass");

for (const adapter of readiness) {
  if (adapter.provider_calls !== 0) fail(`${adapter.harness} readiness must record zero provider calls`);
  if (adapter.validated_capabilities.length !== contract.required_capabilities.length) {
    fail(`${adapter.harness} readiness must validate every required capability`);
  }
  for (const invariant of contract.required_invariants) {
    if (adapter.invariants[invariant] !== true) fail(`${adapter.harness} failed invariant ${invariant}`);
  }
}

const trace = createTraceEvent({
  event: "adapter_hardening_evaluated",
  actor: "architect",
  data: {
    trace_id: "adapter-hardening",
    timestamp: "2026-05-19T00:00:00.000Z",
    status: evaluation.status,
    executable_adapter_count: evaluation.executable_adapter_count,
    hardened_adapter_count: evaluation.hardened_adapter_count,
    invariant_failures: evaluation.invariant_failures,
    provider_calls: evaluation.provider_calls,
    contract: ".ai/harnesses/adapter-hardening.json"
  }
});
writeJsonAtomic(traceOutputPath, trace);

const generatedTrace = readJson(root, ".ai/observability/generated/adapter-hardening.json");
if (generatedTrace.event !== "adapter_hardening_evaluated") fail("Adapter hardening trace event is incorrect");
if (generatedTrace.data.provider_calls !== 0) fail("Adapter hardening trace must record zero provider calls");
if (generatedTrace.data.hardened_adapter_count !== 2) fail("Adapter hardening trace must record two hardened adapters");

const baseline = readJson(root, ".ai/evals/baselines/adapter-hardening.json");
if (baseline.result !== "pass") fail("Adapter hardening baseline must pass");
if (baseline.hardened_adapter_count !== 2) fail("Adapter hardening baseline must record two hardened adapters");
if (baseline.invariant_failures !== 0) fail("Adapter hardening baseline must record zero invariant failures");
if (baseline.provider_calls !== 0) fail("Adapter hardening baseline must record zero provider calls");
if (!baseline.reproducibility?.runtime_entrypoint) fail("Adapter hardening baseline must include reproducibility metadata");

const corePackage = readJson(root, "packages/core/package.json");
if (corePackage.dependencies || corePackage.devDependencies) {
  fail("packages/core must remain dependency-free and harness-agnostic during adapter hardening");
}

const coreSource = fs.readFileSync(path.join(root, "packages/core/src/index.js"), "utf8");
if (coreSource.includes("pi-adapter") || coreSource.includes("opencode-adapter")) {
  fail("packages/core must not import adapter packages");
}

console.log("adapter hardening validation ok: executable adapters are hardened without core leakage or provider calls");
