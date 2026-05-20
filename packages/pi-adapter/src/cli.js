import path from "node:path";
import { runPiAgentSystemSpike, runPiRuntimeSpike } from "./runtime.js";

const root = process.cwd();
const phase = process.argv[2] ?? "phase-2";
const traceOutputPath = path.join(
  root,
  phase === "phase-3"
    ? ".ai/observability/generated/phase-3-delegation-decision.json"
    : ".ai/observability/generated/phase-2-provider-request-avoided.json"
);
const result =
  phase === "phase-3"
    ? runPiAgentSystemSpike({ root, traceOutputPath })
    : runPiRuntimeSpike({ root, traceOutputPath });

console.log(
  JSON.stringify(
    {
      status: "ok",
      phase,
      orchestrator: result.orchestrator.id,
      strategy: result.provider_decision?.strategy ?? "local-only",
      provider_calls: result.provider_decision?.provider_calls ?? result.trace.data.provider_calls,
      trace: path.relative(root, result.trace_output_path)
    },
    null,
    2
  )
);
