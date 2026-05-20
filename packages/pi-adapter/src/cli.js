import path from "node:path";
import { runPiRuntimeSpike } from "./runtime.js";

const root = process.cwd();
const traceOutputPath = path.join(root, ".ai/observability/generated/phase-2-provider-request-avoided.json");
const result = runPiRuntimeSpike({ root, traceOutputPath });

console.log(
  JSON.stringify(
    {
      status: "ok",
      orchestrator: result.orchestrator.id,
      strategy: result.provider_decision.strategy,
      provider_calls: result.provider_decision.provider_calls,
      trace: path.relative(root, result.trace_output_path)
    },
    null,
    2
  )
);
