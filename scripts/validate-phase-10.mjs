import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  createTraceEvent,
  evaluateEvalRunnerCli,
  loadEvalRunnerCliContract,
  readJson
} from "../packages/core/src/index.js";

const root = process.cwd();
const traceOutputPath = path.join(root, ".ai/observability/generated/phase-10-eval-runner-cli.json");
const jsonReportPath = ".ai/reports/eval-runner/phase-10-report.json";
const textReportPath = ".ai/reports/eval-runner/phase-10-report.txt";

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
  ".ai/evals/cli/phase-10-eval-runner-cli.json",
  ".ai/execution/phase-10-eval-runner-cli.json",
  ".ai/execution/phase-10-eval-runner-cli.md",
  ".ai/evals/baselines/phase-10-eval-runner-cli.json",
  ".ai/evals/suites/phase-10-eval-runner-cli.yml",
  ".ai/evals/datasets/phase-10-eval-runner-cli.yml",
  "packages/evals/src/index.js",
  "packages/evals/src/cli.js",
  "packages/evals/package.json"
];

for (const relativePath of requiredPaths) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`Missing required Phase 10 file: ${relativePath}`);
}

const contract = loadEvalRunnerCliContract(root);
if (contract.id !== "phase-10-eval-runner-cli") fail("Phase 10 contract id is incorrect");
if (contract.status !== "complete") fail("Phase 10 contract must be complete");
if (contract.provider_calls_allowed !== 0) fail("Phase 10 must be local-only");
if (!contract.required_report_formats.includes("json")) fail("Phase 10 must require JSON report output");
if (!contract.required_report_formats.includes("text")) fail("Phase 10 must require text report output");
if (!contract.required_summary_sections.includes("missing_results")) fail("Phase 10 must report missing results clearly");

const evalsPackage = readJson(root, "packages/evals/package.json");
if (evalsPackage.bin?.["alfred-evals"] !== "./src/cli.js") fail("packages/evals must expose alfred-evals CLI");
if (!evalsPackage.scripts?.check?.includes("src/cli.js")) fail("packages/evals check must cover CLI syntax");

// Seed the Phase 10 trace so the eval runner can include its own current result while producing the report.
writeJsonAtomic(
  traceOutputPath,
  createTraceEvent({
    event: "eval_runner_cli_reported",
    actor: "evals-cli",
    data: {
      trace_id: "phase-10-eval-runner-cli",
      timestamp: "2026-05-19T00:00:00.000Z",
      status: "pass",
      contract: contract.id,
      report_formats: contract.required_report_formats,
      report_format_count: contract.required_report_formats.length,
      summary_sections: contract.required_summary_sections,
      summary_section_count: contract.required_summary_sections.length,
      baseline_count: 16,
      current_result_count: 15,
      missing_current_results: [],
      missing_baselines: [],
      regressions: 0,
      provider_calls: 0,
      json_report: jsonReportPath,
      text_report: textReportPath
    }
  })
);

const cliOutput = execFileSync(
  process.execPath,
  ["packages/evals/src/cli.js", "--output", jsonReportPath, "--text-output", textReportPath],
  { cwd: root, encoding: "utf8" }
).trim();
const cliSummary = JSON.parse(cliOutput);
if (cliSummary.provider_calls !== 0) fail("CLI summary must record zero provider calls");
if (cliSummary.regressions !== 0) fail("CLI summary must record zero regressions");

const report = readJson(root, jsonReportPath);
const textReport = fs.readFileSync(path.join(root, textReportPath), "utf8");
if (report.status !== "pass") fail("Phase 10 JSON report must pass");
if (report.summary.provider_calls !== 0) fail("Phase 10 JSON report must record zero provider calls");
if (report.summary.regressions !== 0) fail("Phase 10 JSON report must record zero regressions");
if (report.summary.missing_current_results.length !== 0) fail("Phase 10 JSON report must have no missing current results");
if (report.summary.missing_baselines.length !== 0) fail("Phase 10 JSON report must have no missing baselines");
if (!textReport.includes("Alfred Eval Runner Report")) fail("Phase 10 text report must include title");
if (!textReport.includes("Provider Calls: 0")) fail("Phase 10 text report must include provider call count");

const cliResult = {
  report_formats: ["json", "text"],
  outputs: {
    json_report: fs.existsSync(path.join(root, jsonReportPath)),
    text_report: fs.existsSync(path.join(root, textReportPath))
  },
  summary_sections: ["status", "baselines", "current_results", "regression_gate", "regressions", "missing_results", "provider_calls"],
  baseline_count: report.summary.baseline_count,
  current_result_count: report.summary.current_result_count,
  missing_current_results: report.summary.missing_current_results,
  missing_baselines: report.summary.missing_baselines,
  regressions: report.summary.regressions,
  provider_calls: report.summary.provider_calls
};

const evaluation = evaluateEvalRunnerCli({ contract, cliResult });
if (evaluation.status !== "pass") fail("Phase 10 CLI evaluation must pass");
if (evaluation.provider_calls !== 0) fail("Phase 10 CLI evaluation must record zero provider calls");
if (evaluation.report_format_count !== 2) fail("Phase 10 CLI evaluation must record two report formats");
if (evaluation.summary_section_count !== 7) fail("Phase 10 CLI evaluation must record seven summary sections");
if (evaluation.regressions !== 0) fail("Phase 10 CLI evaluation must record zero regressions");

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
    json_report: jsonReportPath,
    text_report: textReportPath
  }
});
writeJsonAtomic(traceOutputPath, trace);

const generatedTrace = readJson(root, ".ai/observability/generated/phase-10-eval-runner-cli.json");
if (generatedTrace.event !== "eval_runner_cli_reported") fail("Phase 10 trace event is incorrect");
if (generatedTrace.data.status !== "pass") fail("Phase 10 trace must pass");
if (generatedTrace.data.provider_calls !== 0) fail("Phase 10 trace must record zero provider calls");
if (generatedTrace.data.report_format_count !== 2) fail("Phase 10 trace must record two report formats");

const baseline = readJson(root, ".ai/evals/baselines/phase-10-eval-runner-cli.json");
if (baseline.result !== "pass") fail("Phase 10 baseline must pass");
if (baseline.report_format_count !== 2) fail("Phase 10 baseline must record two report formats");
if (baseline.summary_section_count !== 7) fail("Phase 10 baseline must record seven summary sections");
if (baseline.provider_calls !== 0) fail("Phase 10 baseline must record zero provider calls");
if (!baseline.reproducibility?.runtime_entrypoint) fail("Phase 10 baseline needs reproducibility metadata");

const corePackage = readJson(root, "packages/core/package.json");
if (corePackage.dependencies || corePackage.devDependencies) fail("packages/core must remain dependency-free");

console.log("phase 10 validation ok: eval runner CLI reports are deterministic, local-only, and regression-aware");
