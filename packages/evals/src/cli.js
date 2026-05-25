#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildEvalRunnerReport, formatEvalRunnerTextReport } from "./index.js";

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    output: ".ai/reports/eval-runner/report.json",
    textOutput: ".ai/reports/eval-runner/report.txt"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--root") args.root = argv[++index];
    if (value === "--output") args.output = argv[++index];
    if (value === "--text-output") args.textOutput = argv[++index];
  }

  return args;
}

function writeFileAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, content);
  fs.renameSync(temporaryPath, filePath);
}

const args = parseArgs(process.argv.slice(2));
const report = buildEvalRunnerReport({ root: args.root });
const jsonOutputPath = path.resolve(args.root, args.output);
const textOutputPath = path.resolve(args.root, args.textOutput);

writeFileAtomic(jsonOutputPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileAtomic(textOutputPath, formatEvalRunnerTextReport(report));

console.log(
  JSON.stringify({
    status: report.status,
    baseline_count: report.summary.baseline_count,
    current_result_count: report.summary.current_result_count,
    regressions: report.summary.regressions,
    provider_calls: report.summary.provider_calls,
    json_report: args.output,
    text_report: args.textOutput
  })
);
