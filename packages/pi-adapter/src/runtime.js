import fs from "node:fs";
import path from "node:path";
import {
  createTraceEvent,
  decideProviderRequest,
  enforcePermission,
  evaluatePermission,
  loadAgent,
  loadArchitectureKernel,
  loadLazySkill,
  orchestrateTask,
  readJson
} from "../../core/src/index.js";

const phase2Task = {
  id: "schema-validation-local-only",
  input: "Validate this agent registry",
  local_reason: "Agent registry validation is deterministic and does not require semantic provider judgment"
};

export function runPiRuntimeSpike({ root, traceOutputPath }) {
  const kernel = loadArchitectureKernel(root);
  const orchestrator = loadAgent(kernel, "orchestrator");
  const permissionCheck = enforcePermission({
    permissions: kernel.permissions,
    agentId: orchestrator.id,
    intent: "read_files"
  });
  const selectedSkill = loadLazySkill(kernel.skills, null);
  const localCapabilities = readJson(root, ".ai/execution/local-capabilities.json");
  const localCapability = localCapabilities.capabilities.find(
    (capability) => capability.id === "validate_agent_registry"
  );

  const decision = decideProviderRequest({
    providerPolicy: kernel.providerPolicy,
    localCapability,
    task: phase2Task
  });

  const trace = createTraceEvent({
    event: decision.trace_event,
    actor: "pi-adapter",
    data: {
      trace_id: "phase-2-pi-runtime-spike-provider-request-avoided",
      timestamp: "2026-05-19T00:00:00.000Z",
      task_id: phase2Task.id,
      agent_id: orchestrator.id,
      skill_id: selectedSkill?.id ?? null,
      strategy: decision.strategy,
      provider_calls: decision.provider_calls,
      local_capability: decision.local_capability,
      permission_check: permissionCheck,
      reason: decision.reason,
      model_assignment_source: "user-owned-runtime-configuration"
    }
  });

  fs.mkdirSync(path.dirname(traceOutputPath), { recursive: true });
  fs.writeFileSync(traceOutputPath, `${JSON.stringify(trace, null, 2)}\n`);

  return {
    manifest_phase: kernel.manifest.phase,
    orchestrator,
    selected_skill: selectedSkill,
    permission_check: permissionCheck,
    provider_decision: decision,
    trace_output_path: traceOutputPath,
    trace
  };
}

export function runPiAgentSystemSpike({ root, traceOutputPath }) {
  const kernel = loadArchitectureKernel(root);
  const orchestrator = loadAgent(kernel, "orchestrator");
  const scenarios = [
    {
      id: "small-task-no-delegation",
      input: "Fix a typo in one file"
    },
    {
      id: "qa-specialist-delegation",
      input: "Reproduce a failing test and design regression coverage"
    },
    {
      id: "temporary-agent-proposal",
      input: "Create a Terraform module and enforce provider-specific conventions"
    }
  ];

  const decisions = scenarios.map((scenario) => ({
    scenario_id: scenario.id,
    input: scenario.input,
    ...orchestrateTask({ kernel, input: scenario.input })
  }));

  const trace = createTraceEvent({
    event: "delegation_decision",
    actor: "pi-adapter",
    data: {
      trace_id: "phase-3-agent-system-delegation-decision",
      timestamp: "2026-05-19T00:00:00.000Z",
      orchestrator_id: orchestrator.id,
      decisions,
      provider_calls: 0,
      routing_policy: ".ai/agents/routing-policy.json",
      model_assignment_source: "user-owned-runtime-configuration"
    }
  });

  fs.mkdirSync(path.dirname(traceOutputPath), { recursive: true });
  fs.writeFileSync(traceOutputPath, `${JSON.stringify(trace, null, 2)}\n`);

  return {
    manifest_phase: kernel.manifest.phase,
    orchestrator,
    decisions,
    trace_output_path: traceOutputPath,
    trace
  };
}

export function runPiSecuritySpike({ root, traceOutputPath }) {
  const kernel = loadArchitectureKernel(root);
  const orchestrator = loadAgent(kernel, "orchestrator");
  const scenarios = [
    {
      id: "allowed-read-files",
      agent_id: orchestrator.id,
      intent: "read_files",
      target_path: "README.md"
    },
    {
      id: "denied-secret-path",
      agent_id: orchestrator.id,
      intent: "read_files",
      target_path: ".env"
    },
    {
      id: "denied-destructive-command",
      agent_id: "developer",
      intent: "delete_files",
      command: "rm -rf packages/core"
    },
    {
      id: "denied-permission-broadening",
      agent_id: orchestrator.id,
      intent: "modify_permissions"
    },
    {
      id: "denied-unknown-intent",
      agent_id: "librarian",
      intent: "install_dependencies"
    }
  ];

  const permissionChecks = scenarios.map((scenario) => ({
    scenario_id: scenario.id,
    ...evaluatePermission({
      permissions: kernel.permissions,
      agentId: scenario.agent_id,
      intent: scenario.intent,
      targetPath: scenario.target_path,
      command: scenario.command
    })
  }));

  const trace = createTraceEvent({
    event: "permission_enforcement",
    actor: "pi-adapter",
    data: {
      trace_id: "phase-4-security-permission-enforcement",
      timestamp: "2026-05-19T00:00:00.000Z",
      orchestrator_id: orchestrator.id,
      permission_checks: permissionChecks,
      trace_events: permissionChecks.map((check) =>
        check.decision === "allow" ? "permission_allowed" : "permission_denied"
      ),
      provider_calls: 0,
      security_policy: ".ai/policies/security.md",
      permissions_policy: ".ai/policies/permissions.example.json"
    }
  });

  fs.mkdirSync(path.dirname(traceOutputPath), { recursive: true });
  fs.writeFileSync(traceOutputPath, `${JSON.stringify(trace, null, 2)}\n`);

  return {
    manifest_phase: kernel.manifest.phase,
    orchestrator,
    permission_checks: permissionChecks,
    trace_output_path: traceOutputPath,
    trace
  };
}
