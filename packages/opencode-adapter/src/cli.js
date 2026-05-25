#!/usr/bin/env node
import path from "node:path";
import { runOpencodePortabilitySpike, writeOpencodeInstallPreview } from "./runtime.js";

const root = process.cwd();
const args = process.argv.slice(2);
const phase7 = args.includes("--phase7");
const outputIndex = args.indexOf("--output");
const outputDir = outputIndex === -1 ? ".ai/generated/opencode-install" : args[outputIndex + 1];

if (phase7) {
  const traceOutputPath = path.join(root, ".ai/observability/generated/phase-7-harness-portability.json");
  const result = runOpencodePortabilitySpike({ root, traceOutputPath });

  console.log(
    JSON.stringify(
      {
        status: result.portability.status,
        phase: "phase-7",
        harness: "opencode",
        portable_harnesses: result.portability.portable_harnesses,
        required_harnesses: result.portability.required_harnesses,
        provider_calls: result.trace.data.provider_calls,
        trace: path.relative(root, result.trace_output_path)
      },
      null,
      2
    )
  );
} else {
  const preview = writeOpencodeInstallPreview({ root, outputDir });

  console.log(
    JSON.stringify(
      {
        status: "pass",
        phase: "phase-11",
        harness: "opencode",
        install_mode: preview.install_mode,
        output_dir: preview.output_dir,
        file_count: preview.files.length,
        writes_harness_config_by_default: preview.writes_harness_config_by_default,
        human_approval_required_before_write: preview.human_approval_required_before_write,
        restart_required_after_install: preview.restart_required_after_install,
        provider_calls: preview.provider_calls
      },
      null,
      2
    )
  );
}
