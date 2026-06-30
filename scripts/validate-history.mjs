import fs from "node:fs";
import path from "node:path";
import { runPiSecuritySpike } from "../packages/pi-adapter/src/runtime.js";
import { computeCurrentEvalResults, loadEvalBaselines, runEvalRunner } from "../packages/evals/src/index.js";

const root = process.cwd();

const phaseAliases = {
  phase1: "phase-1-architecture-kernel",
  phase2: "phase-2-pi-runtime-spike",
  phase3: "phase-3-agent-system",
  phase4: "phase-4-security-enforcement",
  phase5: "phase-5-evals-regression-gates",
  phase6: "phase-6-skill-packs-lazy-loading",
  phase7: "phase-7-harness-portability",
  phase8: "phase-8-runtime-hardening",
  phase9: "phase-9-adapter-generation",
  phase10: "phase-10-eval-runner-cli"
};

function fail(message) {
  throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function assertPathExists(relativePath, label) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`${label} path does not exist: ${relativePath}`);
}

function assertCoreBoundary() {
  const corePackage = readJson("packages/core/package.json");
  if (corePackage.dependencies || corePackage.devDependencies) {
    fail("packages/core must remain dependency-free and harness-agnostic");
  }

  const coreSource = fs.readFileSync(path.join(root, "packages/core/src/index.js"), "utf8");
  if (coreSource.includes("pi-adapter") || coreSource.includes("opencode-adapter") || coreSource.includes("vscode-adapter")) {
    fail("packages/core must not import adapter packages");
  }
}

function assertManifestPaths() {
  const manifest = readJson(".ai/manifest.json");
  for (const [key, relativePath] of Object.entries(manifest.source_of_truth ?? {})) {
    assertPathExists(relativePath, `manifest.source_of_truth.${key}`);
  }

  for (const [key, value] of Object.entries(manifest)) {
    if (key.endsWith("_entrypoint")) assertPathExists(value, `manifest.${key}`);
  }
}

function assertAgentRegistry() {
  const expectedAgents = ["architect", "developer", "librarian", "orchestrator", "qa", "reviewer"];
  const registry = readJson(".ai/agents/registry.json");
  const actualAgents = registry.agents.map((agent) => agent.id).sort();
  if (JSON.stringify(actualAgents) !== JSON.stringify(expectedAgents)) {
    fail(`Agent registry must contain exactly: ${expectedAgents.join(", ")}`);
  }

  for (const agent of registry.agents) {
    if ("model" in agent || "primary_model" in agent || "fallback_model" in agent) {
      fail(`Agent ${agent.id} must not hardcode model assignment`);
    }
  }
}

function assertPermissionPolicy() {
  const permissions = readJson(".ai/policies/permissions.example.json");
  if (permissions.default !== "deny") fail("Permission policy must deny by default");

  for (const requiredPattern of ["**/.env*", "**/secrets/**", "**/.ssh/**"]) {
    if (!permissions.protectedPaths.includes(requiredPattern)) fail(`Missing protected path pattern: ${requiredPattern}`);
  }

  for (const [agentId, agentPermissions] of Object.entries(permissions.agents)) {
    if (agentPermissions.modify_permissions !== "deny") fail(`${agentId}.modify_permissions must be deny`);
  }
}

function refreshGeneratedTraceIfNeeded(selectedPhases) {
  if (!selectedPhases.includes("phase-4-security-enforcement")) return;

  const traceOutputPath = path.join(root, ".ai/observability/generated/phase-4-permission-enforcement.json");
  const result = runPiSecuritySpike({ root, traceOutputPath });
  const unknownIntentCheck = result.permission_checks.find((check) => check.scenario_id === "denied-unknown-intent");

  if (!unknownIntentCheck) fail("Phase 4 must include denied-unknown-intent scenario");
  if (unknownIntentCheck.intent !== "unknown_intent") fail("Phase 4 unknown intent scenario must use a truly unknown intent");
  if (unknownIntentCheck.decision !== "deny") fail("Phase 4 unknown intent scenario must deny access");
  if (unknownIntentCheck.reason !== "default_deny_policy") fail("Phase 4 unknown intent scenario must exercise default deny");
}

const target = process.argv[2] ?? "all";
const selectedPhases = target === "all" ? Object.values(phaseAliases) : [phaseAliases[target] ?? target];

assertCoreBoundary();
assertManifestPaths();
assertAgentRegistry();
assertPermissionPolicy();
refreshGeneratedTraceIfNeeded(selectedPhases);

const baselines = loadEvalBaselines(root);
const currentResults = computeCurrentEvalResults(root);
const runnerResult = runEvalRunner({ root });

if (runnerResult.provider_calls !== 0) fail("Historical validation must not call providers");
if (runnerResult.regression_gate.status !== "pass") fail("Historical regression gate must pass");

for (const phase of selectedPhases) {
  const baseline = baselines[phase];
  const current = currentResults[phase];

  if (!baseline) fail(`Missing baseline for ${phase}`);
  if (!current) fail(`Missing current result for ${phase}`);
  if (baseline.result && baseline.result !== "pass") fail(`Baseline for ${phase} must pass`);
  if (current.result !== "pass") fail(`Current result for ${phase} must pass`);
  if (current.provider_calls !== 0) fail(`Current result for ${phase} must record zero provider calls`);
}

console.log(`historical validation ok: ${selectedPhases.join(", ")} remain reproducible and local-only`);
