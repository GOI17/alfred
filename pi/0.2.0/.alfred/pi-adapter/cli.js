import path from "node:path";
import {
  runPiAgentSystemSpike,
  runPiEvalGateSpike,
  runPiRuntimeSpike,
  runPiRoadmapReadinessSpike,
  runPiSecuritySpike,
  runPiSkillLoadingSpike
} from "./runtime.js";

const root = process.cwd();
const phase = process.argv[2] ?? "phase-2";
const traceOutputPath = path.join(
  root,
  phase === "phase-6"
    ? ".ai/observability/generated/phase-6-skill-activation.json"
    : phase === "post-phase-7"
    ? ".ai/observability/generated/post-phase-7-roadmap-readiness.json"
    : phase === "phase-5"
    ? ".ai/observability/generated/phase-5-regression-gate.json"
    : phase === "phase-4"
    ? ".ai/observability/generated/phase-4-permission-enforcement.json"
    : phase === "phase-3"
    ? ".ai/observability/generated/phase-3-delegation-decision.json"
    : ".ai/observability/generated/phase-2-provider-request-avoided.json"
);
const result =
  phase === "phase-6"
    ? runPiSkillLoadingSpike({ root, traceOutputPath })
    : phase === "post-phase-7"
    ? runPiRoadmapReadinessSpike({ root, traceOutputPath })
    : phase === "phase-5"
    ? runPiEvalGateSpike({ root, traceOutputPath })
    : phase === "phase-4"
    ? runPiSecuritySpike({ root, traceOutputPath })
    : phase === "phase-3"
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
