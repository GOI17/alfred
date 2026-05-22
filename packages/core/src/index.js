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

export function loadHarnessCompatibility(root) {
  return readJson(root, ".ai/harnesses/compatibility-matrix.json");
}

export function loadPostPhase7Roadmap(root) {
  return readJson(root, ".ai/execution/post-phase-7-roadmap.json");
}

export function loadAdapterHardeningContract(root) {
  return readJson(root, ".ai/harnesses/adapter-hardening.json");
}

export function loadReleaseCandidate(root) {
  return readJson(root, ".ai/releases/release-0.1.0.json");
}

export function evaluateReleaseCandidate({ releaseCandidate, validatorResults }) {
  const resultByValidator = Object.fromEntries(validatorResults.map((result) => [result.validator, result]));
  const missingValidators = releaseCandidate.required_validators.filter((validator) => !resultByValidator[validator]);
  const failedValidators = validatorResults.filter((result) => result.status !== "pass").map((result) => result.validator);
  const providerCalls = validatorResults.reduce((total, result) => total + (result.provider_calls ?? 0), 0);

  return {
    status:
      missingValidators.length === 0 && failedValidators.length === 0 && providerCalls <= releaseCandidate.provider_calls_allowed
        ? "pass"
        : "fail",
    release_id: releaseCandidate.id,
    version: releaseCandidate.version,
    required_validator_count: releaseCandidate.required_validators.length,
    passed_validator_count: validatorResults.filter((result) => result.status === "pass").length,
    missing_validators: missingValidators,
    failed_validators: failedValidators,
    provider_calls: providerCalls
  };
}

export function evaluateAdapterHardening({ contract, readiness }) {
  const readinessByHarness = Object.fromEntries(readiness.map((adapter) => [adapter.harness, adapter]));
  const missingAdapters = contract.executable_adapters.filter((harness) => !readinessByHarness[harness]);
  const failedAdapters = contract.executable_adapters.filter((harness) => readinessByHarness[harness]?.status !== "hardened");
  const invariantFailures = readiness.flatMap((adapter) =>
    contract.required_invariants
      .filter((invariant) => adapter.invariants?.[invariant] !== true)
      .map((invariant) => ({ harness: adapter.harness, invariant }))
  );

  return {
    status: missingAdapters.length === 0 && failedAdapters.length === 0 && invariantFailures.length === 0 ? "pass" : "fail",
    executable_adapter_count: contract.executable_adapters.length,
    hardened_adapter_count: readiness.filter((adapter) => adapter.status === "hardened").length,
    missing_adapters: missingAdapters,
    failed_adapters: failedAdapters,
    invariant_failures: invariantFailures,
    provider_calls: 0
  };
}

export function evaluateReleaseReadiness({ roadmap, completedPhases }) {
  const completed = new Set(completedPhases);
  const missingCompletedPhases = roadmap.completed_phases.filter((phase) => !completed.has(phase));
  const governanceReady = roadmap.governance.issue_branch_pr_required === true;
  const validationReady = roadmap.release_readiness.required_validators.every((validator) =>
    roadmap.release_readiness.validators.includes(validator)
  );
  const nextWorkReady = roadmap.next_milestones.length > 0 && roadmap.next_milestones.every((milestone) => milestone.id && milestone.owner);

  return {
    status: missingCompletedPhases.length === 0 && governanceReady && validationReady && nextWorkReady ? "pass" : "fail",
    completed_phase_count: completedPhases.length,
    roadmap_completed_phase_count: roadmap.completed_phases.length,
    missing_completed_phases: missingCompletedPhases,
    next_milestone_count: roadmap.next_milestones.length,
    governance_ready: governanceReady,
    validation_ready: validationReady,
    next_work_ready: nextWorkReady,
    provider_calls: 0
  };
}

export function evaluateHarnessCapability({ harness, capability }) {
  const supportedStrategies = ["native", "adapter", "generated", "external-script"];
  const strategy = harness.capabilities?.[capability];
  return {
    harness_id: harness.id,
    capability,
    strategy,
    portable: supportedStrategies.includes(strategy),
    reason: supportedStrategies.includes(strategy)
      ? `Capability ${capability} is preserved through ${strategy}`
      : `Capability ${capability} is not portable for ${harness.id}`
  };
}

export function evaluateHarnessPortability({ matrix }) {
  const capabilities = matrix.required_capabilities;
  const harnesses = matrix.harnesses.map((harness) => {
    const capability_results = capabilities.map((capability) => evaluateHarnessCapability({ harness, capability }));
    return {
      harness_id: harness.id,
      priority: harness.priority,
      adapter_status: harness.adapter_status,
      capability_results,
      portable: capability_results.every((result) => result.portable)
    };
  });

  return {
    matrix_version: matrix.version,
    harnesses,
    portable_harnesses: harnesses.filter((harness) => harness.portable).length,
    required_harnesses: harnesses.length,
    provider_calls: 0,
    status: harnesses.every((harness) => harness.portable) ? "pass" : "fail"
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

export function normalizeSkillMetadata(skill) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    triggers: skill.triggers ?? [],
    project_signals: skill.projectSignals ?? [],
    source: skill.source,
    scope: skill.scope,
    body_path: skill.bodyPath,
    allowed_agents: skill.allowedAgents ?? [],
    loads_body_by_default: skill.loadsBodyByDefault === true
  };
}

export function detectProjectSignals({ root, registry }) {
  return registry.skills.map((skill) => {
    const matchedSignals = (skill.projectSignals ?? []).filter((signal) => fs.existsSync(path.join(root, signal)));
    return {
      skill_id: skill.id,
      matched_signals: matchedSignals,
      detected: matchedSignals.length > 0
    };
  });
}

export function selectLazySkills({ registry, input, projectSignals, agentId }) {
  const normalizedInput = input.toLowerCase();
  return registry.skills
    .map((skill) => {
      const metadata = normalizeSkillMetadata(skill);
      const signalMatch = projectSignals.find((signal) => signal.skill_id === skill.id && signal.detected);
      const triggerMatches = metadata.triggers.filter((trigger) => normalizedInput.includes(trigger.toLowerCase()));
      const agentAllowed = metadata.allowed_agents.includes(agentId);
      const selected = agentAllowed && (triggerMatches.length > 0 || Boolean(signalMatch));

      return {
        skill_id: metadata.id,
        selected,
        load_body: false,
        reason: selected
          ? "Matched project signals or explicit task trigger while preserving lazy body loading"
          : "No activation signal for this agent and task",
        matched_triggers: triggerMatches,
        matched_project_signals: signalMatch?.matched_signals ?? [],
        allowed_agent: agentAllowed,
        scope: metadata.scope
      };
    })
    .filter((decision) => decision.selected);
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

export function evaluateMetricRule({ rule, baseline, current }) {
  const currentValue = current[rule.metric];
  const baselineValue = baseline[rule.metric];
  const expectedValue = rule.value ?? baselineValue;

  if (rule.operator === "equals") {
    return currentValue === expectedValue;
  }

  if (rule.operator === "less_than_or_equal_baseline") {
    return typeof currentValue === "number" && typeof baselineValue === "number" && currentValue <= baselineValue;
  }

  if (rule.operator === "greater_than_or_equal_baseline") {
    return typeof currentValue === "number" && typeof baselineValue === "number" && currentValue >= baselineValue;
  }

  throw new Error(`Unsupported regression gate operator: ${rule.operator}`);
}

export function compareEvalBaseline({ phase, baseline, current, rules }) {
  const regressions = rules
    .filter((rule) => !evaluateMetricRule({ rule, baseline, current }))
    .map((rule) => ({
      phase,
      metric: rule.metric,
      operator: rule.operator,
      baseline: baseline[rule.metric],
      current: current[rule.metric],
      expected: rule.value ?? baseline[rule.metric]
    }));

  return {
    phase,
    status: regressions.length === 0 ? "pass" : "fail",
    regressions
  };
}

export function evaluateRegressionGate({ gatePolicy, baselines, currentResults }) {
  const comparisons = gatePolicy.phases.map((phaseGate) => {
    const baseline = baselines[phaseGate.phase];
    const current = currentResults[phaseGate.phase];
    if (!baseline) throw new Error(`Missing baseline for ${phaseGate.phase}`);
    if (!current) throw new Error(`Missing current result for ${phaseGate.phase}`);

    return compareEvalBaseline({
      phase: phaseGate.phase,
      baseline,
      current,
      rules: phaseGate.rules
    });
  });

  const regressions = comparisons.flatMap((comparison) => comparison.regressions);
  return {
    status: regressions.length === 0 ? "pass" : "fail",
    comparisons,
    regressions,
    baseline_update_requires_human_approval: gatePolicy.baseline_update_requires_human_approval === true,
    provider_calls: 0
  };
}
