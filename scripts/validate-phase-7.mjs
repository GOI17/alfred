import fs from "node:fs";
import path from "node:path";
import { runOpencodePortabilitySpike } from "../packages/opencode-adapter/src/runtime.js";

const root = process.cwd();
const traceOutputPath = path.join(root, ".ai/observability/generated/phase-7-harness-portability.json");

function fail(message) {
  throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const requiredPaths = [
  ".ai/harnesses/compatibility-matrix.json",
  ".ai/harnesses/pi/adapter-design.md",
  ".ai/harnesses/opencode/adapter-design.md",
  ".ai/harnesses/claude/adapter-design.md",
  ".ai/harnesses/codex/adapter-design.md",
  ".ai/harnesses/vscode/adapter-design.md",
  ".ai/harnesses/kiro/adapter-design.md",
  ".ai/evals/suites/harness-portability.yml",
  ".ai/evals/datasets/harness-portability.yml",
  ".ai/evals/baselines/phase-7-harness-portability.json",
  "packages/core/src/index.js",
  "packages/opencode-adapter/package.json",
  "packages/opencode-adapter/src/runtime.js",
  "packages/opencode-adapter/src/cli.js"
];

for (const relativePath of requiredPaths) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`Missing required Phase 7 file: ${relativePath}`);
}

const matrix = readJson(".ai/harnesses/compatibility-matrix.json");
const expectedHarnesses = ["pi", "opencode", "claude", "codex", "vscode", "kiro"];
if (matrix.owner !== "core") fail("Phase 7 compatibility matrix must be owned by core");
if (matrix.required_capabilities.length !== 8) fail("Phase 7 must track eight required capabilities");
for (const harnessId of expectedHarnesses) {
  const harness = matrix.harnesses.find((candidate) => candidate.id === harnessId);
  if (!harness) fail(`Missing harness compatibility entry: ${harnessId}`);
  if (!fs.existsSync(path.join(root, harness.design_doc))) fail(`Missing harness design doc: ${harness.design_doc}`);
  for (const capability of matrix.required_capabilities) {
    const strategy = harness.capabilities?.[capability];
    if (!["native", "adapter", "generated", "external-script"].includes(strategy)) {
      fail(`Harness ${harnessId} does not preserve capability ${capability}`);
    }
  }
}

const opencode = matrix.harnesses.find((harness) => harness.id === "opencode");
if (opencode.adapter_status !== "executable-translation-spike") fail("opencode must have an executable translation spike");
if (opencode.adapter_package !== "packages/opencode-adapter") fail("opencode adapter package path is incorrect");

const result = runOpencodePortabilitySpike({ root, traceOutputPath });
if (result.orchestrator.id !== "orchestrator") fail("Phase 7 must translate from the Orchestrator context");
if (result.portability.status !== "pass") fail("Phase 7 portability evaluation must pass");
if (result.portability.required_harnesses !== 6) fail("Phase 7 must evaluate six target harnesses");
if (result.portability.portable_harnesses !== 6) fail("All target harnesses must be portable");
if (result.trace.data.provider_calls !== 0) fail("Phase 7 must not call providers");
if (result.preview.generated_artifacts.agents.length !== 6) fail("opencode preview must generate six agent mappings");
if (result.preview.generated_artifacts.skills.length !== 2) fail("opencode preview must generate two skill mappings");
if (result.preview.invariants.core_imports_opencode !== false) fail("Core must not import opencode concepts");
if (result.preview.invariants.model_assignment_source !== "user-owned-runtime-configuration") {
  fail("Model assignment must remain user-owned at runtime");
}

if (!fs.existsSync(traceOutputPath)) fail("Phase 7 generated trace file was not written");
const trace = readJson(".ai/observability/generated/phase-7-harness-portability.json");
if (trace.event !== "harness_portability_evaluated") fail("Phase 7 trace must be harness_portability_evaluated");
if (trace.actor !== "opencode-adapter") fail("Phase 7 trace must be emitted by opencode-adapter");
if (trace.data.provider_calls !== 0) fail("Phase 7 trace must record zero provider calls");
if (trace.data.required_harnesses !== 6 || trace.data.portable_harnesses !== 6) {
  fail("Phase 7 trace must record all harnesses as portable");
}

const baseline = readJson(".ai/evals/baselines/phase-7-harness-portability.json");
if (baseline.result !== "pass") fail("Phase 7 baseline must pass");
if (baseline.required_harnesses !== 6) fail("Phase 7 baseline must record six harnesses");
if (baseline.portable_harnesses !== 6) fail("Phase 7 baseline must record six portable harnesses");
if (baseline.executable_adapters !== 2) fail("Phase 7 baseline must record Pi and opencode executable adapters");
if (baseline.provider_calls !== 0) fail("Phase 7 baseline must record zero provider calls");
if (!baseline.reproducibility?.runtime_entrypoint) fail("Phase 7 baseline must include runtime entrypoint metadata");

const corePackage = readJson("packages/core/package.json");
if (corePackage.dependencies || corePackage.devDependencies) {
  fail("packages/core must remain dependency-free and harness-agnostic during Phase 7");
}

const coreSource = fs.readFileSync(path.join(root, "packages/core/src/index.js"), "utf8");
if (coreSource.includes("opencode-adapter") || coreSource.includes("pi-adapter")) {
  fail("packages/core must not import adapter packages");
}

console.log("phase 7 validation ok: harness portability matrix and opencode translation spike are local-only and core-agnostic");
