import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const traceTimestamp = "2026-05-26T00:00:00.000Z";

function fail(message) {
  throw new Error(message);
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporaryPath, filePath);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const requiredPaths = [
  ".ai/instructions/install-management.md",
  ".ai/evals/baselines/instructions-install-management.json"
];

for (const relativePath of requiredPaths) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`Missing required instructions file: ${relativePath}`);
}

const instructionsContent = fs.readFileSync(path.join(root, ".ai/instructions/install-management.md"), "utf8");
if (instructionsContent.length === 0) fail("Instructions content must not be empty");

const baseline = readJson(".ai/evals/baselines/instructions-install-management.json");
if (baseline.result !== "pass") fail("Instructions baseline must pass");
if (baseline.provider_calls !== 0) fail("Instructions baseline must record zero provider calls");
if (baseline.local_only !== true) fail("Instructions baseline must enforce local-only");
if (baseline.deny_by_default !== true) fail("Instructions baseline must enforce deny by default");
if (baseline.human_approval_required !== true) fail("Instructions baseline must require human approval");

const checks = {
  hasInstallSection: /#{2,3}\s*Install/.test(instructionsContent),
  hasUpdateSection: /#{2,3}\s*Update/.test(instructionsContent),
  hasUninstallSection: /#{2,3}\s*Uninstall/.test(instructionsContent),
  hasTraceFormat: /Trace Event Format/.test(instructionsContent),
  hasErrorReference: /Error Reference/.test(instructionsContent),
  hasValidationChecklist: /Validation Checklist/.test(instructionsContent),
  modelReadable: /---/.test(instructionsContent) && /id:/.test(instructionsContent),
  localOnly: /local[- ]only|provider_calls.*0/.test(instructionsContent.toLowerCase()),
  denyByDefault: /deny by default/.test(instructionsContent.toLowerCase()),
  humanApprovalRequired: /human approval|human_approval/.test(instructionsContent.toLowerCase()),
  adapterStatusCheck: /adapter_status/.test(instructionsContent) && /executable/.test(instructionsContent),
  harnessAwareness: /compatibility matrix/.test(instructionsContent)
};

const allPassed = Object.values(checks).every(Boolean);
const status = allPassed ? "pass" : "fail";

if (!allPassed) fail("Instructions evaluation must pass");

if (!checks.hasInstallSection) fail("Instructions must contain Install section");
if (!checks.hasUpdateSection) fail("Instructions must contain Update section");
if (!checks.hasUninstallSection) fail("Instructions must contain Uninstall section");
if (!checks.hasTraceFormat) fail("Instructions must contain Trace Event Format section");
if (!checks.hasErrorReference) fail("Instructions must contain Error Reference section");
if (!checks.hasValidationChecklist) fail("Instructions must contain Validation Checklist section");
if (!checks.modelReadable) fail("Instructions must be model-readable (frontmatter)");
if (!checks.localOnly) fail("Instructions must declare local-only execution");
if (!checks.denyByDefault) fail("Instructions must declare deny by default");
if (!checks.humanApprovalRequired) fail("Instructions must declare human approval requirement");
if (!checks.adapterStatusCheck) fail("Instructions must reference adapter_status for harness detection");
if (!checks.harnessAwareness) fail("Instructions must reference compatibility matrix for harness awareness");

const traceOutputPath = path.join(root, ".ai/observability/generated/instructions-install-management.json");
const trace = {
  trace_id: "instructions-install-management",
  timestamp: traceTimestamp,
  event: "instructions_validated",
  actor: "orchestrator",
  data: {
    instruction_file: ".ai/instructions/install-management.md",
    evaluation_status: status,
    checks_passed: Object.values(checks).filter(Boolean).length,
    total_checks: Object.keys(checks).length,
    provider_calls: 0
  }
};
writeJsonAtomic(traceOutputPath, trace);

console.log("instructions-install-management validated ok: model-readable, local-only, deny-by-default, with install/update/uninstall sections, trace format, adapter status checks, and harness awareness");
