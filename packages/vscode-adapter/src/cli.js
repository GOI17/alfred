#!/usr/bin/env node
import path from "node:path";
import { runVscodeIntegrationPreview } from "./runtime.js";

const root = process.cwd();
const result = runVscodeIntegrationPreview({
  root,
  traceOutputPath: path.join(root, ".ai/observability/generated/vscode-integration-preview.json")
});

console.log(
  JSON.stringify(
    {
      harness: result.preview.harness,
      mvp_required: result.preview.mvp_required,
      provider_calls: result.preview.provider_calls,
      trace_output_path: result.trace_output_path
    },
    null,
    2
  )
);
