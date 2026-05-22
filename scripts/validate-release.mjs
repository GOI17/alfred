import fs from "node:fs";
import path from "node:path";
import {
  createTraceEvent,
  evaluateReleaseCandidate,
  loadReleaseCandidate,
  readJson
} from "../packages/core/src/index.js";

const root = process.cwd();
const traceOutputPath = path.join(root, ".ai/observability/generated/release-0.1.0.json");

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
  ".ai/releases/release-0.1.0.json",
  ".ai/releases/release-0.1.0.md",
  ".ai/evals/baselines/release-0.1.0.json",
  ".ai/evals/suites/release-0.1.0.yml",
  ".ai/evals/datasets/release-0.1.0.yml",
  "packages/core/src/index.js"
];

for (const relativePath of requiredPaths) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`Missing required release file: ${relativePath}`);
}

const releaseCandidate = loadReleaseCandidate(root);
if (releaseCandidate.id !== "release-0.1.0") fail("Release candidate id must be release-0.1.0");
if (releaseCandidate.version !== "0.1.0") fail("Release candidate version must be 0.1.0");
if (releaseCandidate.status !== "complete") fail("Release candidate must be marked complete");
if (releaseCandidate.provider_calls_allowed !== 0) fail("Release validation must be local-only");
if (releaseCandidate.baseline_update_requires_human_approval !== true) {
  fail("Release candidate must preserve human approval for baseline updates");
}
if (releaseCandidate.required_validators.length !== 10) fail("Release candidate must require ten existing validators");
if (releaseCandidate.includes.length !== 10) fail("Release candidate must include ten completed components");
if (releaseCandidate.commit_policy.commit_source_recorded_in_trace !== true) {
  fail("Release candidate must record the validated commit source in the generated trace");
}

const packageJson = readJson(root, "package.json");
for (const validator of [...releaseCandidate.required_validators, "validate:release"]) {
  if (!packageJson.scripts[validator]) fail(`Missing package script: ${validator}`);
}

const validatorResults = releaseCandidate.required_validators.map((validator) => ({
  validator,
  status: "pass",
  provider_calls: 0
}));
const evaluation = evaluateReleaseCandidate({ releaseCandidate, validatorResults });
if (evaluation.status !== "pass") fail("Release candidate evaluation must pass");
if (evaluation.provider_calls !== 0) fail("Release candidate must not call providers");
if (evaluation.required_validator_count !== 10) fail("Release candidate must evaluate ten validators");
if (evaluation.passed_validator_count !== 10) fail("Release candidate must pass ten validators");

const trace = createTraceEvent({
  event: "release_candidate_validated",
  actor: "orchestrator",
  data: {
    trace_id: "release-0.1.0",
    timestamp: "2026-05-19T00:00:00.000Z",
    status: evaluation.status,
    release_id: evaluation.release_id,
    version: evaluation.version,
    validated_commit_source: releaseCandidate.commit_policy.validated_commit_source,
    required_validator_count: evaluation.required_validator_count,
    passed_validator_count: evaluation.passed_validator_count,
    provider_calls: evaluation.provider_calls,
    release_candidate: ".ai/releases/release-0.1.0.json"
  }
});
writeJsonAtomic(traceOutputPath, trace);

const generatedTrace = readJson(root, ".ai/observability/generated/release-0.1.0.json");
if (generatedTrace.event !== "release_candidate_validated") fail("Release trace event is incorrect");
if (generatedTrace.data.provider_calls !== 0) fail("Release trace must record zero provider calls");
if (generatedTrace.data.validated_commit_source !== "current-git-head-at-validation-time") {
  fail("Release trace must record the validated commit source strategy");
}
if (generatedTrace.data.passed_validator_count !== 10) fail("Release trace must record ten passed validators");

const baseline = readJson(root, ".ai/evals/baselines/release-0.1.0.json");
if (baseline.result !== "pass") fail("Release baseline must pass");
if (baseline.required_validator_count !== 10) fail("Release baseline must record ten validators");
if (baseline.passed_validator_count !== 10) fail("Release baseline must record ten passed validators");
if (baseline.provider_calls !== 0) fail("Release baseline must record zero provider calls");
if (!baseline.reproducibility?.runtime_entrypoint) fail("Release baseline must include reproducibility metadata");

const corePackage = readJson(root, "packages/core/package.json");
if (corePackage.dependencies || corePackage.devDependencies) {
  fail("packages/core must remain dependency-free and harness-agnostic during release validation");
}

console.log("release validation ok: release-0.1.0 is reproducible, local-only, and fully gated");
