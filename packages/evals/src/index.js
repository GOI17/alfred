import fs from "node:fs";
import path from "node:path";
import { evaluateRegressionGate, readJson } from "../../core/src/index.js";

export const evalRunnerPhases = [
  "phase-1-architecture-kernel",
  "phase-2-pi-runtime-spike",
  "phase-3-agent-system",
  "phase-4-security-enforcement",
  "phase-5-evals-regression-gates",
  "phase-6-skill-packs-lazy-loading",
  "phase-7-harness-portability",
  "post-phase-7-roadmap-readiness",
  "adapter-hardening"
];

export function listEvalBaselines(root) {
  const baselineRoot = path.join(root, ".ai/evals/baselines");
  return fs
    .readdirSync(baselineRoot)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .map((fileName) => `.ai/evals/baselines/${fileName}`);
}

export function loadEvalBaselines(root) {
  return Object.fromEntries(
    listEvalBaselines(root).map((relativePath) => {
      const baseline = readJson(root, relativePath);
      const phase = baseline.phase ?? path.basename(relativePath, ".json");
      return [phase, { ...baseline, phase, baseline_path: relativePath }];
    })
  );
}

export function readGeneratedTrace(root, relativePath) {
  return readJson(root, relativePath);
}

export function computeCurrentEvalResults(root) {
  const phase2Trace = readGeneratedTrace(root, ".ai/observability/generated/phase-2-provider-request-avoided.json");
  const phase3Trace = readGeneratedTrace(root, ".ai/observability/generated/phase-3-delegation-decision.json");
  const phase4Trace = readGeneratedTrace(root, ".ai/observability/generated/phase-4-permission-enforcement.json");
  const phase5Trace = readGeneratedTrace(root, ".ai/observability/generated/phase-5-regression-gate.json");
  const phase6Trace = readGeneratedTrace(root, ".ai/observability/generated/phase-6-skill-activation.json");
  const phase7Trace = readGeneratedTrace(root, ".ai/observability/generated/phase-7-harness-portability.json");
  const roadmapTrace = readGeneratedTrace(root, ".ai/observability/generated/post-phase-7-roadmap-readiness.json");
  const adapterHardeningTrace = readGeneratedTrace(root, ".ai/observability/generated/adapter-hardening.json");
  const phase1Baseline = readJson(root, ".ai/evals/baselines/phase-1-architecture-kernel.json");
  const compatibilityMatrix = readJson(root, ".ai/harnesses/compatibility-matrix.json");

  return {
    "phase-1-architecture-kernel": {
      result: "pass",
      checks: phase1Baseline.checks,
      provider_calls: phase1Baseline.reproducibility.provider_calls
    },
    "phase-2-pi-runtime-spike": {
      result: "pass",
      provider_calls: phase2Trace.data.provider_calls,
      trace_event: phase2Trace.event
    },
    "phase-3-agent-system": summarizeDelegationTrace(phase3Trace),
    "phase-4-security-enforcement": summarizePermissionTrace(phase4Trace),
    "phase-5-evals-regression-gates": {
      result: phase5Trace.data.status,
      phases_compared: phase5Trace.data.comparisons.length,
      regressions: phase5Trace.data.regressions.length,
      provider_calls: phase5Trace.data.provider_calls,
      baseline_update_requires_human_approval: phase5Trace.data.baseline_update_requires_human_approval,
      trace_event: phase5Trace.event
    },
    "phase-6-skill-packs-lazy-loading": {
      result: "pass",
      registered_skills: readJson(root, ".ai/skills/registry.json").skills.length,
      project_scoped_skills: readJson(root, ".ai/skills/registry.json").skills.filter((skill) => skill.scope === "project").length,
      selected_skills: phase6Trace.data.selected_skill_ids.length,
      loaded_skill_bodies: phase6Trace.data.loaded_skill_bodies,
      provider_calls: phase6Trace.data.provider_calls,
      trace_event: phase6Trace.event
    },
    "phase-7-harness-portability": {
      result: phase7Trace.data.portability_status,
      required_harnesses: phase7Trace.data.required_harnesses,
      portable_harnesses: phase7Trace.data.portable_harnesses,
      executable_adapters: compatibilityMatrix.harnesses.filter((harness) =>
        ["executable-spike", "executable-translation-spike"].includes(harness.adapter_status)
      ).length,
      compatibility_contracts: compatibilityMatrix.harnesses.filter(
        (harness) => harness.adapter_status === "compatibility-contract"
      ).length,
      opencode_generated_agents: phase7Trace.data.generated_artifacts.agents.length,
      opencode_generated_skills: phase7Trace.data.generated_artifacts.skills.length,
      provider_calls: phase7Trace.data.provider_calls,
      trace_event: phase7Trace.event
    },
    "post-phase-7-roadmap-readiness": {
      result: roadmapTrace.data.status,
      completed_phase_count: roadmapTrace.data.completed_phase_count,
      next_milestone_count: roadmapTrace.data.next_milestone_count,
      governance_ready: roadmapTrace.data.governance_ready,
      validation_ready: roadmapTrace.data.validation_ready,
      next_work_ready: roadmapTrace.data.next_work_ready,
      provider_calls: roadmapTrace.data.provider_calls,
      trace_event: roadmapTrace.event
    },
    "adapter-hardening": {
      result: adapterHardeningTrace.data.status,
      executable_adapter_count: adapterHardeningTrace.data.executable_adapter_count,
      hardened_adapter_count: adapterHardeningTrace.data.hardened_adapter_count,
      invariant_failures: adapterHardeningTrace.data.invariant_failures.length,
      provider_calls: adapterHardeningTrace.data.provider_calls,
      trace_event: adapterHardeningTrace.event
    }
  };
}

export function runEvalRunner({ root }) {
  const baselines = loadEvalBaselines(root);
  const currentResults = computeCurrentEvalResults(root);
  const gatePolicy = readJson(root, ".ai/evals/regression-gates.json");
  const gateBaselines = Object.fromEntries(gatePolicy.phases.map((phaseGate) => [phaseGate.phase, baselines[phaseGate.phase]]));
  const gateCurrentResults = Object.fromEntries(
    gatePolicy.phases.map((phaseGate) => [phaseGate.phase, currentResults[phaseGate.phase]])
  );
  const regressionGate = evaluateRegressionGate({
    gatePolicy,
    baselines: gateBaselines,
    currentResults: gateCurrentResults
  });

  return {
    status: regressionGate.status,
    baseline_count: Object.keys(baselines).length,
    current_result_count: Object.keys(currentResults).length,
    phases: evalRunnerPhases,
    missing_current_results: evalRunnerPhases.filter((phase) => !currentResults[phase]),
    missing_baselines: evalRunnerPhases.filter((phase) => !baselines[phase]),
    regression_gate: regressionGate,
    provider_calls: 0
  };
}

function summarizeDelegationTrace(trace) {
  const decisions = trace.data.decisions;
  return {
    result: "pass",
    cases: decisions.length,
    small_task_delegations: decisions.filter(
      (decision) => decision.task_classification.complexity === "small" && decision.delegation === true
    ).length,
    specialist_delegations: decisions.filter((decision) => decision.delegation === true).length,
    temporary_agent_proposals: decisions.filter((decision) => decision.temporary_agent_proposal).length,
    provider_calls: trace.data.provider_calls,
    trace_event: trace.event
  };
}

function summarizePermissionTrace(trace) {
  const checks = trace.data.permission_checks;
  return {
    result: "pass",
    cases: checks.length,
    allowed_permissions: checks.filter((check) => check.decision === "allow").length,
    denied_permissions: checks.filter((check) => check.decision === "deny").length,
    protected_path_denials: checks.filter((check) => check.reason === "target_path_matches_protected_paths").length,
    destructive_command_denials: checks.filter((check) => check.reason === "command_matches_destructive_defaults").length,
    permission_broadening_denials: checks.filter(
      (check) => check.scenario_id === "denied-permission-broadening" && check.decision === "deny"
    ).length,
    default_denials: checks.filter((check) => check.reason === "default_deny_policy").length,
    provider_calls: trace.data.provider_calls,
    trace_event: trace.event
  };
}
