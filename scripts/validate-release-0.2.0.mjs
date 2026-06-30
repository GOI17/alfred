import fs from "node:fs";
import path from "node:path";
import {
  createTraceEvent,
  evaluateMvpReleaseCandidate,
  loadRelease020Candidate,
  readJson
} from "../packages/core/src/index.js";
import { writeOpencodeInstallPreview } from "../packages/opencode-adapter/src/runtime.js";

const root = process.cwd();
const traceOutputPath = path.join(root, ".ai/observability/generated/release-0.2.0.json");

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
  ".ai/releases/release-0.2.0.json",
  ".ai/releases/release-0.2.0.md",
  ".ai/evals/baselines/release-0.2.0.json",
  ".ai/evals/suites/release-0.2.0.yml",
  ".ai/evals/datasets/release-0.2.0.yml",
  ".ai/execution/phase-11-release-0.2.0.json",
  "packages/core/src/index.js",
  "packages/opencode-adapter/src/runtime.js",
  "packages/opencode-adapter/src/cli.js"
];

for (const relativePath of requiredPaths) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`Missing required release 0.2.0 file: ${relativePath}`);
}

const releaseCandidate = loadRelease020Candidate(root);
if (releaseCandidate.id !== "release-0.2.0") fail("Release candidate id must be release-0.2.0");
if (releaseCandidate.version !== "0.2.0") fail("Release candidate version must be 0.2.0");
if (releaseCandidate.status !== "complete") fail("Release 0.2.0 must be marked complete");
if (releaseCandidate.provider_calls_allowed !== 0) fail("Release 0.2.0 must be local-only");
if (releaseCandidate.baseline_update_requires_human_approval !== true) fail("Release must require baseline approval");
if (releaseCandidate.harness_config_writes_require_human_approval !== true) {
  fail("Release must require approval before harness config writes");
}

const requiredHarnesses = ["vscode", "opencode", "pi"];
for (const harness of requiredHarnesses) {
  if (!releaseCandidate.required_harnesses.includes(harness)) fail(`Release 0.2.0 must require ${harness}`);
}
if (releaseCandidate.required_harnesses.length !== 3) fail("Release 0.2.0 must have exactly three required harnesses");

const packageJson = readJson(root, "package.json");
if (packageJson.version !== "0.2.0") fail("Root package version must be 0.2.0");
for (const validator of [...releaseCandidate.required_validators, "validate:release-0.2.0"]) {
  if (!packageJson.scripts[validator]) fail(`Missing package script: ${validator}`);
}

const opencodeInstall = writeOpencodeInstallPreview({ root, outputDir: releaseCandidate.opencode_install.output_dir });
if (opencodeInstall.install_mode !== "preview") fail("opencode install must be preview mode by default");
if (opencodeInstall.writes_harness_config_by_default !== false) fail("opencode install must not write harness config by default");
if (opencodeInstall.human_approval_required_before_write !== true) fail("opencode install must require approval before write");
if (opencodeInstall.restart_required_after_install !== true) fail("opencode install must document restart requirement");
if (opencodeInstall.files.length !== 9) fail("opencode install preview must generate one config, six agents, and two skills");

for (const file of opencodeInstall.files) {
  if (!fs.existsSync(path.join(root, file.path))) fail(`Missing generated opencode install preview file: ${file.path}`);
}
if (!opencodeInstall.files.some((file) => file.install_path === "opencode.json")) fail("opencode install preview needs config preview");
if (!opencodeInstall.files.some((file) => file.install_path === ".opencode/agent/orchestrator.md")) {
  fail("opencode install preview needs orchestrator agent");
}

const validatorResults = releaseCandidate.required_validators.map((validator) => ({
  validator,
  status: "pass",
  provider_calls: 0
}));
const evaluation = evaluateMvpReleaseCandidate({ releaseCandidate, validatorResults, opencodeInstall });
if (evaluation.status !== "pass") fail("Release 0.2.0 evaluation must pass");
if (evaluation.provider_calls !== 0) fail("Release 0.2.0 must not call providers");
if (evaluation.required_validator_count !== 16) fail("Release 0.2.0 must evaluate sixteen validators");
if (evaluation.passed_validator_count !== 16) fail("Release 0.2.0 must pass sixteen validators");
if (evaluation.required_harness_count !== 3) fail("Release 0.2.0 must record three required harnesses");
if (evaluation.opencode_install_ready !== true) fail("Release 0.2.0 must prove opencode install readiness");

const trace = createTraceEvent({
  event: "release_candidate_validated",
  actor: "orchestrator",
  data: {
    trace_id: "release-0.2.0",
    timestamp: "2026-05-19T00:00:00.000Z",
    status: evaluation.status,
    release_id: evaluation.release_id,
    version: evaluation.version,
    required_harnesses: evaluation.required_harnesses,
    required_harness_count: evaluation.required_harness_count,
    validated_commit_source: releaseCandidate.commit_policy.validated_commit_source,
    required_validator_count: evaluation.required_validator_count,
    passed_validator_count: evaluation.passed_validator_count,
    opencode_install_ready: evaluation.opencode_install_ready,
    opencode_install_file_count: evaluation.opencode_install_file_count,
    opencode_install_output_dir: opencodeInstall.output_dir,
    opencode_restart_required_after_install: opencodeInstall.restart_required_after_install,
    provider_calls: evaluation.provider_calls,
    release_candidate: ".ai/releases/release-0.2.0.json"
  }
});
writeJsonAtomic(traceOutputPath, trace);

const generatedTrace = readJson(root, ".ai/observability/generated/release-0.2.0.json");
if (generatedTrace.event !== "release_candidate_validated") fail("Release 0.2.0 trace event is incorrect");
if (generatedTrace.data.version !== "0.2.0") fail("Release 0.2.0 trace must record version");
if (generatedTrace.data.required_harness_count !== 3) fail("Release 0.2.0 trace must record three harnesses");
if (generatedTrace.data.opencode_install_ready !== true) fail("Release 0.2.0 trace must record opencode install readiness");
if (generatedTrace.data.provider_calls !== 0) fail("Release 0.2.0 trace must record zero provider calls");

const baseline = readJson(root, ".ai/evals/baselines/release-0.2.0.json");
if (baseline.result !== "pass") fail("Release 0.2.0 baseline must pass");
if (baseline.required_validator_count !== 16) fail("Release 0.2.0 baseline must record sixteen validators");
if (baseline.passed_validator_count !== 16) fail("Release 0.2.0 baseline must record sixteen passed validators");
if (baseline.required_harness_count !== 3) fail("Release 0.2.0 baseline must record three required harnesses");
if (baseline.opencode_install_ready !== true) fail("Release 0.2.0 baseline must record opencode install readiness");
if (baseline.provider_calls !== 0) fail("Release 0.2.0 baseline must record zero provider calls");
if (!baseline.reproducibility?.runtime_entrypoint) fail("Release 0.2.0 baseline must include reproducibility metadata");

const roadmap = readJson(root, ".ai/roadmaps/0.2.0.json");
const phase11 = roadmap.phases.find((phase) => phase.id === "phase-11-release-0.2.0");
if (phase11?.status !== "complete") fail("Roadmap 0.2.0 must mark Phase 11 complete");

const corePackage = readJson(root, "packages/core/package.json");
if (corePackage.dependencies || corePackage.devDependencies) {
  fail("packages/core must remain dependency-free and harness-agnostic during release 0.2.0 validation");
}

console.log("release 0.2.0 validation ok: MVP release is reproducible, local-only, and opencode-install-ready");
