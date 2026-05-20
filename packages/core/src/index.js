import fs from "node:fs";
import path from "node:path";

export function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

export function loadArchitectureKernel(root) {
  const manifest = readJson(root, ".ai/manifest.json");
  if (manifest.phase !== "phase-1-architecture-kernel" || manifest.status !== "complete") {
    throw new Error("Alfred Pi spike requires a complete Phase 1 architecture kernel");
  }

  return {
    manifest,
    agents: readJson(root, ".ai/agents/registry.json"),
    routingPolicy: readJson(root, ".ai/agents/routing-policy.json"),
    skills: readJson(root, ".ai/skills/registry.json"),
    permissions: readJson(root, ".ai/policies/permissions.example.json"),
    providerPolicy: readJson(root, ".ai/policies/provider-request-policy.example.json"),
    modelAssignment: readJson(root, ".ai/policies/model-assignment.example.json")
  };
}

export function classifyTask({ routingPolicy, input }) {
  const normalized = input.toLowerCase();
  const simpleMatch = routingPolicy.simple_task_indicators.find((indicator) => normalized.includes(indicator));
  if (simpleMatch) {
    return {
      complexity: "small",
      reason: `Matched simple task indicator: ${simpleMatch}`
    };
  }

  const specialistMatch = routingPolicy.specialists
    .flatMap((specialist) => specialist.triggers.map((trigger) => ({ specialist, trigger })))
    .find(({ trigger }) => normalized.includes(trigger));

  return {
    complexity: specialistMatch ? "specialized" : "unknown-specialized",
    reason: specialistMatch
      ? `Matched specialist trigger: ${specialistMatch.trigger}`
      : "No existing specialist trigger matched the task"
  };
}

export function selectSpecialist({ routingPolicy, input }) {
  const normalized = input.toLowerCase();
  return (
    routingPolicy.specialists.find((specialist) => specialist.triggers.some((trigger) => normalized.includes(trigger))) ?? null
  );
}

export function proposeTemporaryAgent({ routingPolicy, input, reason }) {
  return {
    temporary_agent_proposed: true,
    human_approval_required: true,
    proposal_id: routingPolicy.temporary_agent.proposal_id,
    proposed_role: routingPolicy.temporary_agent.default_role,
    source_task: input,
    reason,
    permissions: routingPolicy.temporary_agent.permissions,
    promotion_requires_human_approval: routingPolicy.temporary_agent.promotion_requires_human_approval
  };
}

export function orchestrateTask({ kernel, input }) {
  const classification = classifyTask({ routingPolicy: kernel.routingPolicy, input });
  if (classification.complexity === "small") {
    return {
      task_classification: classification,
      delegation: false,
      target_agent: "orchestrator",
      temporary_agent_proposal: null,
      reason: "Small/simple tasks stay with the Orchestrator"
    };
  }

  const specialist = selectSpecialist({ routingPolicy: kernel.routingPolicy, input });
  if (specialist) {
    return {
      task_classification: classification,
      delegation: true,
      target_agent: specialist.id,
      temporary_agent_proposal: null,
      reason: `Specialist ${specialist.id} matched task triggers`
    };
  }

  return {
    task_classification: classification,
    delegation: false,
    target_agent: "orchestrator",
    temporary_agent_proposal: proposeTemporaryAgent({
      routingPolicy: kernel.routingPolicy,
      input,
      reason: classification.reason
    }),
    reason: "No existing specialist fits; human approval is required before creating a temporary specialist"
  };
}

export function loadAgent(kernel, agentId) {
  const agent = kernel.agents.agents.find((candidate) => candidate.id === agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);
  return agent;
}

export function loadLazySkill(registry, skillId) {
  if (!skillId) return null;

  const skill = registry.skills.find((candidate) => candidate.id === skillId);
  if (!skill) throw new Error(`Skill not found: ${skillId}`);
  return skill;
}

export function enforcePermission({ permissions, agentId, intent }) {
  const evaluation = evaluatePermission({ permissions, agentId, intent });
  if (evaluation.decision !== "allow") {
    throw new Error(`Permission denied for ${agentId}:${intent}`);
  }

  return evaluation;
}

export function isProtectedPath({ permissions, targetPath }) {
  if (!targetPath) return false;
  return (permissions.protectedPaths ?? []).some((pattern) => {
    if (pattern === "**/.env*") return targetPath.split("/").some((part) => part.startsWith(".env"));
    if (pattern === "**/secrets/**") return targetPath.includes("/secrets/") || targetPath.startsWith("secrets/");
    if (pattern === "**/.ssh/**") return targetPath.includes("/.ssh/") || targetPath.startsWith(".ssh/");
    return targetPath.includes(pattern.replaceAll("*", ""));
  });
}

export function isDestructiveCommand(command) {
  if (!command) return false;
  const normalized = command.trim().toLowerCase();
  return ["rm ", "rm -", "git reset --hard", "git clean", "chmod 777", "dd "].some((prefix) =>
    normalized.startsWith(prefix)
  );
}

export function evaluatePermission({ permissions, agentId, intent, targetPath = null, command = null }) {
  if (isProtectedPath({ permissions, targetPath })) {
    return {
      agent_id: agentId,
      intent,
      decision: "deny",
      reason: "target_path_matches_protected_paths",
      target_path: targetPath,
      policy_source: "protectedPaths"
    };
  }

  if (isDestructiveCommand(command)) {
    return {
      agent_id: agentId,
      intent,
      decision: "deny",
      reason: "command_matches_destructive_defaults",
      command,
      policy_source: "destructive_command_defaults"
    };
  }

  const decision = permissions.agents?.[agentId]?.[intent] ?? permissions.default;
  return {
    agent_id: agentId,
    intent,
    decision,
    reason: permissions.agents?.[agentId]?.[intent]
      ? "matched_agent_permission"
      : "default_deny_policy",
    policy_source: permissions.agents?.[agentId]?.[intent] ? `agents.${agentId}.${intent}` : "default"
  };
}

export function decideProviderRequest({ providerPolicy, localCapability, task }) {
  if (providerPolicy.default_strategy !== "local-first") {
    throw new Error("Provider policy must default to local-first");
  }

  if (localCapability?.can_complete === true) {
    return {
      strategy: "local-only",
      provider_calls: 0,
      local_capability: localCapability.id,
      reason: task.local_reason,
      trace_event: "provider_request_avoided"
    };
  }

  return {
    strategy: "hybrid",
    provider_calls: 1,
    local_capability: localCapability?.id ?? "none",
    reason: "No deterministic local capability can complete the task",
    trace_event: "provider_request_reduced"
  };
}

export function createTraceEvent({ event, actor, data }) {
  return {
    trace_id: data.trace_id,
    timestamp: data.timestamp,
    event,
    actor,
    data
  };
}
