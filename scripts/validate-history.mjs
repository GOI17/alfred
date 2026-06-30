import fs from "node:fs";
import path from "node:path";
import {
  createTraceEvent,
  evaluateAdapterGeneration,
  evaluateRuntimeHardening,
  evaluateEvalRunnerCli,
  loadAdapterGenerationContract,
  loadEvalRunnerCliContract,
  loadRuntimeHardeningContract
} from "../packages/core/src/index.js";
import { buildPiIntegrationPreview, buildPiStableRuntime, runPiSecuritySpike } from "../packages/pi-adapter/src/runtime.js";
import {
  buildOpencodeIntegrationPreview,
  buildOpencodeStableRuntime,
  runOpencodePortabilitySpike
} from "../packages/opencode-adapter/src/runtime.js";
import { buildCodexIntegrationPreview, buildCodexStableRuntime } from "../packages/codex-adapter/src/runtime.js";
import { buildVscodeIntegrationPreview } from "../packages/vscode-adapter/src/runtime.js";
import {
  buildEvalRunnerReport,
  computeCurrentEvalResults,
  formatEvalRunnerTextReport,
  loadEvalBaselines,
  runEvalRunner
} from "../packages/evals/src/index.js";

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
  if (
    coreSource.includes("pi-adapter") ||
    coreSource.includes("opencode-adapter") ||
    coreSource.includes("vscode-adapter") ||
    coreSource.includes("codex-adapter")
  ) {
    fail("packages/core must not import adapter packages");
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporaryPath, filePath);
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
  if (selectedPhases.includes("phase-4-security-enforcement")) {
    const traceOutputPath = path.join(root, ".ai/observability/generated/phase-4-permission-enforcement.json");
    const result = runPiSecuritySpike({ root, traceOutputPath });
    const unknownIntentCheck = result.permission_checks.find((check) => check.scenario_id === "denied-unknown-intent");

    if (!unknownIntentCheck) fail("Phase 4 must include denied-unknown-intent scenario");
    if (unknownIntentCheck.intent !== "unknown_intent") fail("Phase 4 unknown intent scenario must use a truly unknown intent");
    if (unknownIntentCheck.decision !== "deny") fail("Phase 4 unknown intent scenario must deny access");
    if (unknownIntentCheck.reason !== "default_deny_policy") fail("Phase 4 unknown intent scenario must exercise default deny");
  }

  if (selectedPhases.includes("phase-7-harness-portability")) {
    runOpencodePortabilitySpike({
      root,
      traceOutputPath: path.join(root, ".ai/observability/generated/phase-7-harness-portability.json")
    });
  }

  if (selectedPhases.includes("phase-8-runtime-hardening")) {
    const contract = loadRuntimeHardeningContract(root);
    const adapters = [
      buildPiStableRuntime({ root }),
      buildOpencodeStableRuntime({ root }),
      buildCodexStableRuntime({ root })
    ];
    const evaluation = evaluateRuntimeHardening({ contract, adapters });
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
    writeJsonAtomic(path.join(root, ".ai/observability/generated/phase-8-runtime-hardening.json"), trace);
  }

  if (selectedPhases.includes("phase-9-adapter-generation")) {
    const contract = loadAdapterGenerationContract(root);
    const previews = [
      buildVscodeIntegrationPreview({ root }),
      buildOpencodeIntegrationPreview({ root }),
      buildPiIntegrationPreview({ root }),
      buildCodexIntegrationPreview({ root }),
      buildPreviewOnlyHarness("claude"),
      buildPreviewOnlyHarness("kiro")
    ];
    const evaluation = evaluateAdapterGeneration({ contract, previews });
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
    writeJsonAtomic(path.join(root, ".ai/observability/generated/phase-9-adapter-generation.json"), trace);
  }

  if (selectedPhases.includes("phase-10-eval-runner-cli")) {
    const contract = loadEvalRunnerCliContract(root);
    const report = buildEvalRunnerReport({ root });
    const jsonReport = ".ai/reports/eval-runner/phase-10-report.json";
    const textReport = ".ai/reports/eval-runner/phase-10-report.txt";
    writeJsonAtomic(path.join(root, jsonReport), report);
    fs.writeFileSync(path.join(root, textReport), formatEvalRunnerTextReport(report));
    const cliResult = {
      report_formats: ["json", "text"],
      outputs: {
        json_report: jsonReport,
        text_report: textReport
      },
      summary_sections: [
        "status",
        "baselines",
        "current_results",
        "regression_gate",
        "regressions",
        "missing_results",
        "provider_calls"
      ],
      baseline_count: report.summary.baseline_count,
      current_result_count: report.summary.current_result_count,
      missing_current_results: report.summary.missing_current_results,
      missing_baselines: report.summary.missing_baselines,
      regressions: report.summary.regressions,
      provider_calls: report.summary.provider_calls
    };
    const evaluation = evaluateEvalRunnerCli({ contract, cliResult });
    const trace = createTraceEvent({
      event: "eval_runner_cli_reported",
      actor: "evals-cli",
      data: {
        trace_id: "phase-10-eval-runner-cli",
        timestamp: "2026-05-19T00:00:00.000Z",
        status: evaluation.status,
        contract: evaluation.contract,
        report_formats: evaluation.report_formats,
        report_format_count: evaluation.report_format_count,
        summary_sections: evaluation.summary_sections,
        summary_section_count: evaluation.summary_section_count,
        baseline_count: evaluation.baseline_count,
        current_result_count: evaluation.current_result_count,
        missing_current_results: evaluation.missing_current_results,
        missing_baselines: evaluation.missing_baselines,
        regressions: evaluation.regressions,
        missing_formats: evaluation.missing_formats,
        missing_outputs: evaluation.missing_outputs,
        missing_sections: evaluation.missing_sections,
        provider_calls: evaluation.provider_calls,
        json_report: jsonReport,
        text_report: textReport
      }
    });
    writeJsonAtomic(path.join(root, ".ai/observability/generated/phase-10-eval-runner-cli.json"), trace);
  }
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
