import fs from "node:fs";
import path from "node:path";
import { runPiRuntimeSpike } from "../packages/pi-adapter/src/runtime.js";

const root = process.cwd();
const traceOutputPath = path.join(root, ".ai/observability/generated/phase-2-provider-request-avoided.json");

function fail(message) {
  throw new Error(message);
}

const result = runPiRuntimeSpike({ root, traceOutputPath });

if (result.manifest_phase !== "phase-1-architecture-kernel") fail("Phase 2 must load the complete Phase 1 kernel");
if (result.orchestrator.id !== "orchestrator") fail("Phase 2 must load the orchestrator from the agent registry");
if (result.permission_check.decision !== "allow") fail("Phase 2 must enforce one allowed permission rule");
if (result.permission_check.intent !== "read_files") fail("Phase 2 permission check must cover read_files");
if (result.selected_skill !== null) fail("Phase 2 spike should load zero skills when the lazy registry is empty");
if (result.provider_decision.strategy !== "local-only") fail("Phase 2 local-first path must run local-only");
if (result.provider_decision.provider_calls !== 0) fail("Phase 2 local-first path must avoid provider calls");
if (result.trace.event !== "provider_request_avoided") fail("Phase 2 must emit provider_request_avoided");
if (!fs.existsSync(traceOutputPath)) fail("Phase 2 generated trace file was not written");

const trace = JSON.parse(fs.readFileSync(traceOutputPath, "utf8"));
if (trace.event !== "provider_request_avoided") fail("Generated Phase 2 trace has wrong event");
if (trace.data.provider_calls !== 0) fail("Generated Phase 2 trace must record zero provider calls");
if (trace.data.agent_id !== "orchestrator") fail("Generated Phase 2 trace must record orchestrator agent");
if (trace.data.permission_check?.decision !== "allow") fail("Generated Phase 2 trace must include allowed permission check");

const baseline = JSON.parse(
  fs.readFileSync(path.join(root, ".ai/evals/baselines/phase-2-pi-runtime-spike.json"), "utf8")
);
if (baseline.result !== "pass") fail("Phase 2 baseline must pass");
if (baseline.provider_calls !== 0) fail("Phase 2 baseline must record zero provider calls");
if (baseline.trace_event !== "provider_request_avoided") fail("Phase 2 baseline must record provider_request_avoided");
if (!baseline.reproducibility?.runtime_entrypoint) fail("Phase 2 baseline must include runtime entrypoint metadata");

const corePackage = JSON.parse(fs.readFileSync(path.join(root, "packages/core/package.json"), "utf8"));
if (corePackage.dependencies || corePackage.devDependencies) {
  fail("packages/core must remain dependency-free and harness-agnostic during Phase 2");
}

console.log("phase 2 validation ok: pi runtime spike produced provider_request_avoided trace");
