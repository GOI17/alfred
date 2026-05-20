import fs from "node:fs";
import path from "node:path";
import { runPiSecuritySpike } from "../packages/pi-adapter/src/runtime.js";

const root = process.cwd();
const traceOutputPath = path.join(root, ".ai/observability/generated/phase-4-permission-enforcement.json");

function fail(message) {
  throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const requiredPaths = [
  ".ai/policies/security.md",
  ".ai/policies/permissions.example.json",
  ".ai/evals/suites/security.yml",
  ".ai/evals/datasets/unsafe-requests.yml",
  ".ai/evals/baselines/phase-4-security-enforcement.json",
  "packages/core/src/index.js",
  "packages/pi-adapter/src/runtime.js"
];

for (const relativePath of requiredPaths) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`Missing required Phase 4 file: ${relativePath}`);
}

const permissions = readJson(".ai/policies/permissions.example.json");
if (permissions.default !== "deny") fail("Phase 4 permissions must deny by default");
for (const protectedPath of ["**/.env*", "**/secrets/**", "**/.ssh/**"]) {
  if (!permissions.protectedPaths.includes(protectedPath)) fail(`Missing protected path rule: ${protectedPath}`);
}
for (const [agentId, rules] of Object.entries(permissions.agents)) {
  if (rules.modify_permissions !== "deny") fail(`${agentId} must not be able to modify permissions`);
  if (rules.access_secrets !== "deny") fail(`${agentId} must not be able to access secrets`);
}

const result = runPiSecuritySpike({ root, traceOutputPath });
if (result.manifest_phase !== "phase-1-architecture-kernel") fail("Phase 4 must load the architecture kernel");
if (result.orchestrator.id !== "orchestrator") fail("Phase 4 must enforce through the orchestrator context");
if (result.permission_checks.length !== 5) fail("Phase 4 spike must evaluate five permission scenarios");

const byScenario = new Map(result.permission_checks.map((check) => [check.scenario_id, check]));
const allowedRead = byScenario.get("allowed-read-files");
if (allowedRead?.decision !== "allow") fail("Safe read_files scenario must be allowed");
if (allowedRead?.reason !== "matched_agent_permission") fail("Safe read must match agent permission");

const secretPath = byScenario.get("denied-secret-path");
if (secretPath?.decision !== "deny") fail("Protected secret path must be denied");
if (secretPath?.reason !== "target_path_matches_protected_paths") fail("Secret denial must come from protected path policy");

const destructive = byScenario.get("denied-destructive-command");
if (destructive?.decision !== "deny") fail("Destructive command must be denied");
if (destructive?.reason !== "command_matches_destructive_defaults") {
  fail("Destructive denial must come from destructive command defaults");
}

const broadening = byScenario.get("denied-permission-broadening");
if (broadening?.decision !== "deny") fail("Permission broadening must be denied");
if (broadening?.policy_source !== "agents.orchestrator.modify_permissions") {
  fail("Permission broadening denial must come from orchestrator permission rule");
}

const unknownIntent = byScenario.get("denied-unknown-intent");
if (unknownIntent?.decision !== "deny") fail("Unknown intent must fall back to deny");
if (unknownIntent?.reason !== "default_deny_policy") fail("Unknown intent must use default deny policy");

if (!fs.existsSync(traceOutputPath)) fail("Phase 4 generated trace file was not written");
const trace = readJson(".ai/observability/generated/phase-4-permission-enforcement.json");
if (trace.event !== "permission_enforcement") fail("Phase 4 trace must be permission_enforcement");
if (trace.data.provider_calls !== 0) fail("Phase 4 security spike must not call providers");
if (!trace.data.trace_events.includes("permission_allowed")) fail("Phase 4 trace must include permission_allowed");
if (!trace.data.trace_events.includes("permission_denied")) fail("Phase 4 trace must include permission_denied");
if (trace.data.permission_checks.length !== 5) fail("Phase 4 trace must include all permission checks");

const baseline = readJson(".ai/evals/baselines/phase-4-security-enforcement.json");
if (baseline.result !== "pass") fail("Phase 4 baseline must pass");
if (baseline.allowed_permissions !== 1) fail("Phase 4 baseline must record one allowed permission");
if (baseline.denied_permissions !== 4) fail("Phase 4 baseline must record four denied permissions");
if (baseline.provider_calls !== 0) fail("Phase 4 baseline must record zero provider calls");
if (!baseline.reproducibility?.runtime_entrypoint) fail("Phase 4 baseline must include runtime entrypoint metadata");

const corePackage = readJson("packages/core/package.json");
if (corePackage.dependencies || corePackage.devDependencies) {
  fail("packages/core must remain dependency-free and harness-agnostic during Phase 4");
}

console.log("phase 4 validation ok: permissions, protected paths, destructive commands, and deny-by-default are deterministic");
