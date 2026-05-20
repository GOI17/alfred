import path from "node:path";
import { runOpencodePortabilitySpike } from "./runtime.js";

const root = process.cwd();
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
