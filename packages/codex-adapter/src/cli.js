#!/usr/bin/env node
import { writeCodexInstallPreview } from "./runtime.js";

const root = process.cwd();
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output");
const outputDir = outputIndex === -1 ? ".ai/generated/codex-install" : args[outputIndex + 1];

const preview = writeCodexInstallPreview({ root, outputDir });

console.log(
  JSON.stringify(
    {
      status: "pass",
      harness: "codex",
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
