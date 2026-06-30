import fs from "node:fs";
import path from "node:path";
import { runEvalRunner, evalRunnerPhases } from "../packages/evals/src/index.js";

const root = process.cwd();

function fail(message) {
  throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const requiredPaths = [
  "packages/evals/src/index.js",
  "packages/evals/package.json",
  "packages/evals/README.md",
  ".ai/execution/eval-runner-package.json",
  ".ai/evals/baselines/eval-runner-package.json",
  ".ai/evals/suites/eval-runner-package.yml",
  ".ai/evals/datasets/eval-runner-package.yml"
];

for (const relativePath of requiredPaths) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`Missing required eval runner file: ${relativePath}`);
}

const packageJson = readJson("packages/evals/package.json");
if (packageJson.scripts.check.includes("no implementation yet")) fail("evals check script must execute real validation");
if (packageJson.scripts.test.includes("no implementation yet")) fail("evals test script must execute real validation");
if (packageJson.exports !== "./src/index.js") fail("evals package must expose its runner API");

const milestone = readJson(".ai/execution/eval-runner-package.json");
if (milestone.id !== "eval-runner-package") fail("Milestone id must be eval-runner-package");
if (milestone.status !== "complete") fail("Eval runner package milestone must be marked complete");
if (milestone.provider_calls_allowed !== 0) fail("Eval runner package must remain local-only");
if (milestone.apis.length < 3) fail("Eval runner package must document API surface");

const result = runEvalRunner({ root });
if (result.status !== "pass") fail("Eval runner regression gate must pass");
if (result.provider_calls !== 0) fail("Eval runner must not call providers");
if (result.baseline_count < evalRunnerPhases.length + 1) fail("Eval runner must discover every baseline including its own");
if (result.current_result_count !== evalRunnerPhases.length) fail("Eval runner must compute every current result");
if (result.missing_current_results.length !== 0) fail("Eval runner has missing current results");
if (result.missing_baselines.length !== 0) fail("Eval runner has missing baselines");
if (result.regression_gate.regressions.length !== 0) fail("Eval runner must preserve zero regressions");
if (result.regression_gate.comparisons.length !== 4) fail("Eval runner must preserve Phase 5 regression comparisons");

const baseline = readJson(".ai/evals/baselines/eval-runner-package.json");
if (baseline.result !== "pass") fail("Eval runner baseline must pass");
if (baseline.baseline_count !== result.baseline_count) fail("Eval runner baseline must record the discovered baseline count");
if (baseline.current_result_count !== evalRunnerPhases.length) fail("Eval runner baseline must record every current result");
if (baseline.provider_calls !== 0) fail("Eval runner baseline must record zero provider calls");
if (!baseline.reproducibility?.runtime_entrypoint) fail("Eval runner baseline must include runtime entrypoint metadata");

const corePackage = readJson("packages/core/package.json");
if (corePackage.dependencies || corePackage.devDependencies) {
  fail("packages/core must remain dependency-free and harness-agnostic during eval runner packaging");
}

console.log("eval runner validation ok: package APIs compute local current results and preserve regression gates");
