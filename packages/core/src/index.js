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
    skills: readJson(root, ".ai/skills/registry.json"),
    permissions: readJson(root, ".ai/policies/permissions.example.json"),
    providerPolicy: readJson(root, ".ai/policies/provider-request-policy.example.json"),
    modelAssignment: readJson(root, ".ai/policies/model-assignment.example.json")
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
  const decision = permissions.agents?.[agentId]?.[intent] ?? permissions.default;
  if (decision !== "allow") {
    throw new Error(`Permission denied for ${agentId}:${intent}`);
  }

  return {
    agent_id: agentId,
    intent,
    decision
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
