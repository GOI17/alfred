import fs from "node:fs";
import path from "node:path";
import {
  createTraceEvent,
  evaluateAdapterGeneration,
  loadAdapterGenerationContract,
  readJson
} from "../packages/core/src/index.js";
import { buildOpencodeIntegrationPreview } from "../packages/opencode-adapter/src/runtime.js";
import { buildPiIntegrationPreview } from "../packages/pi-adapter/src/runtime.js";
import { buildVscodeIntegrationPreview } from "../packages/vscode-adapter/src/runtime.js";

const root = process.cwd();
const traceOutputPath = path.join(root, ".ai/observability/generated/phase-9-adapter-generation.json");

function fail(message) {
  throw new Error(message);
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporaryPath, filePath);
}

function buildPreviewOnlyHarness(harness) {
  return {
    harness,
    mvp_required: false,
    preview_only: true,
    adapter_package: null,
    generated_artifacts: {
      compatibility_contract: `.ai/harnesses/${harness}/adapter-design.md`,
      artifact_mode: "preview-only",
      promotion_requires_human_approval: true
    },
    writes_harness_config_by_default: false,
    human_approval_required_before_write: true,
    provider_calls: 0
  };
}

const requiredPaths = [
  ".ai/adapters/phase-9-adapter-generation.json",
  ".ai/execution/phase-9-adapter-generation.json",
  ".ai/execution/phase-9-adapter-generation.md",
  ".ai/evals/baselines/phase-9-adapter-generation.json",
  ".ai/evals/suites/phase-9-adapter-generation.yml",
  ".ai/evals/datasets/phase-9-adapter-generation.yml",
  "packages/vscode-adapter/src/runtime.js",
  "packages/opencode-adapter/src/runtime.js",
  "packages/pi-adapter/src/runtime.js"
];

for (const relativePath of requiredPaths) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`Missing required Phase 9 file: ${relativePath}`);
}

const contract = loadAdapterGenerationContract(root);
if (contract.id !== "phase-9-adapter-generation") fail("Phase 9 contract id is incorrect");
if (contract.status !== "complete") fail("Phase 9 contract must be complete");
if (contract.provider_calls_allowed !== 0) fail("Phase 9 must be local-only");
if (contract.writes_harness_config_by_default !== false) fail("Phase 9 must not write harness config by default");
if (contract.human_approval_required_before_write !== true) fail("Phase 9 must require approval before writes");

const requiredHarnesses = ["vscode", "opencode", "pi"];
const previewHarnesses = ["claude", "codex", "kiro"];
if (JSON.stringify(contract.required_harnesses) !== JSON.stringify(requiredHarnesses)) {
  fail("Phase 9 required harnesses must be vscode, opencode, and pi");
}
if (JSON.stringify(contract.preview_harnesses) !== JSON.stringify(previewHarnesses)) {
  fail("Phase 9 preview harnesses must be claude, codex, and kiro");
}

const previews = [
  buildVscodeIntegrationPreview({ root }),
  buildOpencodeIntegrationPreview({ root }),
  buildPiIntegrationPreview({ root }),
  ...previewHarnesses.map(buildPreviewOnlyHarness)
];
const evaluation = evaluateAdapterGeneration({ contract, previews });

if (evaluation.status !== "pass") fail("Phase 9 adapter generation evaluation must pass");
if (evaluation.required_harness_count !== 3) fail("Phase 9 must have three required harnesses");
if (evaluation.preview_harness_count !== 3) fail("Phase 9 must have three preview harnesses");
if (evaluation.generated_harness_count !== 6) fail("Phase 9 must generate six harness previews");
if (evaluation.provider_calls !== 0) fail("Phase 9 must record zero provider calls");
if (evaluation.write_gate_failures.length !== 0) fail("Phase 9 generated previews must not write config by default");
if (evaluation.approval_failures.length !== 0) fail("Phase 9 generated previews must require approval before writes");
if (evaluation.artifact_failures.length !== 0) fail("Phase 9 generated previews must include artifacts");

const trace = createTraceEvent({
  event: "adapter_generation_evaluated",
  actor: "developer",
  data: {
    trace_id: "phase-9-adapter-generation",
    timestamp: "2026-05-19T00:00:00.000Z",
    status: evaluation.status,
    contract: evaluation.contract,
    required_harnesses: evaluation.required_harnesses,
    preview_harnesses: evaluation.preview_harnesses,
    generated_harnesses: evaluation.generated_harnesses,
    required_harness_count: evaluation.required_harness_count,
    preview_harness_count: evaluation.preview_harness_count,
    generated_harness_count: evaluation.generated_harness_count,
    write_gate_failures: evaluation.write_gate_failures,
    approval_failures: evaluation.approval_failures,
    artifact_failures: evaluation.artifact_failures,
    provider_calls: evaluation.provider_calls,
    previews
  }
});
writeJsonAtomic(traceOutputPath, trace);

const generatedTrace = readJson(root, ".ai/observability/generated/phase-9-adapter-generation.json");
if (generatedTrace.event !== "adapter_generation_evaluated") fail("Phase 9 trace event is incorrect");
if (generatedTrace.data.required_harness_count !== 3) fail("Phase 9 trace must record three required harnesses");
if (generatedTrace.data.generated_harness_count !== 6) fail("Phase 9 trace must record six generated harnesses");
if (generatedTrace.data.provider_calls !== 0) fail("Phase 9 trace must record zero provider calls");

const baseline = readJson(root, ".ai/evals/baselines/phase-9-adapter-generation.json");
if (baseline.result !== "pass") fail("Phase 9 baseline must pass");
if (baseline.required_harness_count !== 3) fail("Phase 9 baseline must record three required harnesses");
if (baseline.preview_harness_count !== 3) fail("Phase 9 baseline must record three preview harnesses");
if (baseline.generated_harness_count !== 6) fail("Phase 9 baseline must record six generated harnesses");
if (baseline.provider_calls !== 0) fail("Phase 9 baseline must record zero provider calls");
if (!baseline.reproducibility?.runtime_entrypoint) fail("Phase 9 baseline needs reproducibility metadata");

const corePackage = readJson(root, "packages/core/package.json");
if (corePackage.dependencies || corePackage.devDependencies) fail("packages/core must remain dependency-free");
const coreSource = fs.readFileSync(path.join(root, "packages/core/src/index.js"), "utf8");
for (const forbidden of ["pi-adapter", "opencode-adapter", "vscode-adapter"]) {
  if (coreSource.includes(forbidden)) fail(`packages/core must not import ${forbidden}`);
}

console.log("phase 9 validation ok: MVP harness previews are generated locally with approval-gated writes");
