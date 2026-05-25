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

export function loadRelease020Candidate(root) {
  return readJson(root, ".ai/releases/release-0.2.0.json");
}

export function loadRoadmap020(root) {
  return readJson(root, ".ai/roadmaps/0.2.0.json");
}

export function loadRuntimeHardeningContract(root) {
  return readJson(root, ".ai/runtime/phase-8-runtime-hardening.json");
}

export function loadMvpReleasePlan(root) {
  return readJson(root, ".ai/roadmaps/mvp-release.json");
}

export function loadAdapterGenerationContract(root) {
  return readJson(root, ".ai/adapters/phase-9-adapter-generation.json");
}

export function loadEvalRunnerCliContract(root) {
  return readJson(root, ".ai/evals/cli/phase-10-eval-runner-cli.json");
}

export function evaluateEvalRunnerCli({ contract, cliResult }) {
  const missingFormats = contract.required_report_formats.filter((format) => !cliResult.report_formats?.includes(format));
  const missingOutputs = contract.required_outputs.filter((output) => !cliResult.outputs?.[output]);
  const missingSections = contract.required_summary_sections.filter((section) => !cliResult.summary_sections?.includes(section));

  return {
    status:
      missingFormats.length === 0 &&
      missingOutputs.length === 0 &&
      missingSections.length === 0 &&
      cliResult.regressions === 0 &&
      cliResult.provider_calls <= contract.provider_calls_allowed
        ? "pass"
        : "fail",
    contract: contract.id,
    report_formats: cliResult.report_formats,
    report_format_count: cliResult.report_formats.length,
    summary_sections: cliResult.summary_sections,
    summary_section_count: cliResult.summary_sections.length,
    baseline_count: cliResult.baseline_count,
    current_result_count: cliResult.current_result_count,
    missing_current_results: cliResult.missing_current_results,
    missing_baselines: cliResult.missing_baselines,
    regressions: cliResult.regressions,
    missing_formats: missingFormats,
    missing_outputs: missingOutputs,
    missing_sections: missingSections,
    provider_calls: cliResult.provider_calls
  };
}

export function evaluateAdapterGeneration({ contract, previews }) {
  const previewByHarness = Object.fromEntries(previews.map((preview) => [preview.harness, preview]));
  const missingRequiredHarnesses = contract.required_harnesses.filter((harness) => !previewByHarness[harness]);
  const missingPreviewHarnesses = contract.preview_harnesses.filter((harness) => !previewByHarness[harness]);
  const requiredHarnessFailures = contract.required_harnesses.filter(
    (harness) => previewByHarness[harness]?.mvp_required !== true
  );
  const previewHarnessFailures = contract.preview_harnesses.filter(
    (harness) => previewByHarness[harness]?.mvp_required !== false || previewByHarness[harness]?.preview_only !== true
  );
  const writeGateFailures = previews.filter((preview) => preview.writes_harness_config_by_default !== false).map((preview) => preview.harness);
  const approvalFailures = previews.filter((preview) => preview.human_approval_required_before_write !== true).map((preview) => preview.harness);
  const artifactFailures = previews
    .filter((preview) => !preview.generated_artifacts || Object.keys(preview.generated_artifacts).length === 0)
    .map((preview) => preview.harness);
  const providerCalls = previews.reduce((total, preview) => total + (preview.provider_calls ?? 0), 0);

  return {
    status:
      missingRequiredHarnesses.length === 0 &&
      missingPreviewHarnesses.length === 0 &&
      requiredHarnessFailures.length === 0 &&
      previewHarnessFailures.length === 0 &&
      writeGateFailures.length === 0 &&
      approvalFailures.length === 0 &&
      artifactFailures.length === 0 &&
      providerCalls <= contract.provider_calls_allowed
        ? "pass"
        : "fail",
    contract: contract.id,
    required_harnesses: contract.required_harnesses,
    preview_harnesses: contract.preview_harnesses,
    generated_harnesses: previews.map((preview) => preview.harness),
    required_harness_count: contract.required_harnesses.length,
    preview_harness_count: contract.preview_harnesses.length,
    generated_harness_count: previews.length,
    missing_required_harnesses: missingRequiredHarnesses,
    missing_preview_harnesses: missingPreviewHarnesses,
    required_harness_failures: requiredHarnessFailures,
    preview_harness_failures: previewHarnessFailures,
    write_gate_failures: writeGateFailures,
    approval_failures: approvalFailures,
    artifact_failures: artifactFailures,
    provider_calls: providerCalls
  };
}

export function evaluateMvpReleasePlan({ plan, roadmap }) {
  const requiredMvpHarnesses = ["vscode", "opencode", "pi"];
  const roadmapPhaseIds = new Set(roadmap.phases.map((phase) => phase.id));
  const planPhaseIds = plan.phases.map((phase) => phase.id);
  const missingRoadmapPhases = planPhaseIds.filter((phaseId) => !roadmapPhaseIds.has(phaseId));
  const duplicatePlanPhases = planPhaseIds.filter((phaseId, index) => planPhaseIds.indexOf(phaseId) !== index);
  const unorderedPlanPhases = plan.phases.filter((phase, index) => phase.order !== index + 1).map((phase) => phase.id);
  const phasesWithoutAcceptance = plan.phases.filter((phase) => !phase.acceptance_criteria?.length).map((phase) => phase.id);
  const phasesWithoutValidation = plan.phases.filter((phase) => !phase.validation?.length).map((phase) => phase.id);
  const nonLocalPhases = plan.phases.filter((phase) => phase.provider_calls_allowed !== 0).map((phase) => phase.id);
  const requiredHarnesses = plan.required_harnesses ?? [];
  const previewHarnesses = plan.preview_harnesses ?? [];
  const missingRequiredHarnesses = requiredMvpHarnesses.filter((harness) => !requiredHarnesses.includes(harness));
  const previewHarnessConflicts = previewHarnesses.filter((harness) => requiredHarnesses.includes(harness));
  const phase9 = plan.phases.find((phase) => phase.id === "phase-9-adapter-generation");
  const phase9Text = `${phase9?.goal ?? ""} ${(phase9?.deliverables ?? []).join(" ")} ${(
    phase9?.acceptance_criteria ?? []
  ).join(" ")}`.toLowerCase();
  const phase9MissingRequiredHarnesses = requiredMvpHarnesses.filter((harness) => !phase9Text.includes(harness));

  return {
    status:
      missingRoadmapPhases.length === 0 &&
      duplicatePlanPhases.length === 0 &&
      unorderedPlanPhases.length === 0 &&
      phasesWithoutAcceptance.length === 0 &&
      phasesWithoutValidation.length === 0 &&
      nonLocalPhases.length === 0 &&
      missingRequiredHarnesses.length === 0 &&
      previewHarnessConflicts.length === 0 &&
      phase9MissingRequiredHarnesses.length === 0 &&
      plan.provider_calls_allowed === 0
        ? "pass"
        : "fail",
    plan_id: plan.id,
    target_release: plan.target_release,
    phase_count: plan.phases.length,
    required_harnesses: requiredHarnesses,
    preview_harnesses: previewHarnesses,
    required_harness_count: requiredHarnesses.length,
    preview_harness_count: previewHarnesses.length,
    release_gate_count: plan.release_gates.length,
    non_goal_count: plan.non_goals.length,
    missing_roadmap_phases: missingRoadmapPhases,
    duplicate_plan_phases: duplicatePlanPhases,
    unordered_plan_phases: unorderedPlanPhases,
    phases_without_acceptance: phasesWithoutAcceptance,
    phases_without_validation: phasesWithoutValidation,
    non_local_phases: nonLocalPhases,
    missing_required_harnesses: missingRequiredHarnesses,
    preview_harness_conflicts: previewHarnessConflicts,
    phase9_missing_required_harnesses: phase9MissingRequiredHarnesses,
    provider_calls: 0
  };
}

export function evaluateRuntimeHardening({ contract, adapters }) {
  const adapterByHarness = Object.fromEntries(adapters.map((adapter) => [adapter.harness, adapter]));
  const missingAdapters = contract.executable_adapters.filter((harness) => !adapterByHarness[harness]);
  const unstableAdapters = contract.executable_adapters.filter((harness) => adapterByHarness[harness]?.status !== "stable");
  const capabilityFailures = adapters.flatMap((adapter) =>
    contract.required_capabilities
      .filter((capability) => !adapter.capabilities?.includes(capability))
      .map((capability) => ({ harness: adapter.harness, capability }))
  );
  const traceFailures = adapters.flatMap((adapter) =>
    contract.required_trace_events
      .filter((event) => !adapter.trace_events?.includes(event))
      .map((event) => ({ harness: adapter.harness, event }))
  );
  const boundaryFailures = adapters.flatMap((adapter) =>
    contract.required_boundaries
      .filter((boundary) => adapter.boundaries?.[boundary] !== true)
      .map((boundary) => ({ harness: adapter.harness, boundary }))
  );
  const providerCalls = adapters.reduce((total, adapter) => total + (adapter.provider_calls ?? 0), 0);

  return {
    status:
      missingAdapters.length === 0 &&
      unstableAdapters.length === 0 &&
      capabilityFailures.length === 0 &&
      traceFailures.length === 0 &&
      boundaryFailures.length === 0 &&
      providerCalls <= contract.provider_calls_allowed
        ? "pass"
        : "fail",
    runtime_contract: contract.id,
    stable_adapter_count: adapters.filter((adapter) => adapter.status === "stable").length,
    executable_adapter_count: contract.executable_adapters.length,
    missing_adapters: missingAdapters,
    unstable_adapters: unstableAdapters,
    capability_failures: capabilityFailures,
    trace_failures: traceFailures,
    boundary_failures: boundaryFailures,
    provider_calls: providerCalls
  };
}

export function evaluateRoadmap020({ roadmap }) {
  const phaseIds = roadmap.phases.map((phase) => phase.id);
  const duplicatePhases = phaseIds.filter((phaseId, index) => phaseIds.indexOf(phaseId) !== index);
  const missingValidators = roadmap.phases.filter((phase) => !phase.validation || phase.validation.length === 0).map((phase) => phase.id);
  const nonLocalPhases = roadmap.phases.filter((phase) => phase.provider_calls_allowed !== 0).map((phase) => phase.id);
  const unorderedPhases = roadmap.phases.filter((phase, index) => phase.order !== index + 1).map((phase) => phase.id);

  return {
    status:
      duplicatePhases.length === 0 && missingValidators.length === 0 && nonLocalPhases.length === 0 && unorderedPhases.length === 0
        ? "pass"
        : "fail",
    roadmap_id: roadmap.id,
    version: roadmap.version,
    phase_count: roadmap.phases.length,
    duplicate_phases: duplicatePhases,
    missing_validators: missingValidators,
    non_local_phases: nonLocalPhases,
    unordered_phases: unorderedPhases,
    provider_calls: 0
  };
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

export function evaluateMvpReleaseCandidate({ releaseCandidate, validatorResults, opencodeInstall }) {
  const releaseEvaluation = evaluateReleaseCandidate({ releaseCandidate, validatorResults });
  const requiredHarnesses = ["vscode", "opencode", "pi"];
  const missingRequiredHarnesses = requiredHarnesses.filter((harness) => !releaseCandidate.required_harnesses?.includes(harness));
  const missingIncludedPhases = ["phase-8-runtime-hardening", "phase-9-adapter-generation", "phase-10-eval-runner-cli"].filter(
    (phase) => !releaseCandidate.includes?.includes(phase)
  );
  const opencodeInstallReady =
    opencodeInstall?.harness === "opencode" &&
    opencodeInstall?.install_mode === "preview" &&
    opencodeInstall?.writes_harness_config_by_default === false &&
    opencodeInstall?.human_approval_required_before_write === true &&
    opencodeInstall?.restart_required_after_install === true &&
    opencodeInstall?.provider_calls === 0 &&
    opencodeInstall?.files?.length > 0;

  return {
    ...releaseEvaluation,
    status:
      releaseEvaluation.status === "pass" &&
      missingRequiredHarnesses.length === 0 &&
      missingIncludedPhases.length === 0 &&
      opencodeInstallReady
        ? "pass"
        : "fail",
    required_harnesses: releaseCandidate.required_harnesses ?? [],
    required_harness_count: releaseCandidate.required_harnesses?.length ?? 0,
    missing_required_harnesses: missingRequiredHarnesses,
    missing_included_phases: missingIncludedPhases,
    opencode_install_ready: opencodeInstallReady,
    opencode_install_file_count: opencodeInstall?.files?.length ?? 0
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
  return [
    "rm ",
    "rm -",
    "git reset --hard",
    "git clean",
    "chmod 777",
    "dd ",
    "git clone ",
    "pnpm install",
    "npm install",
    "yarn install",
    "bun install"
  ].some((prefix) => normalized.startsWith(prefix));
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

export function evaluateInstallManagementInstructions({ root }) {
  const baseline = readJson(root, ".ai/evals/baselines/instructions-install-management.json");
  return {
    status: baseline.result === "pass" && baseline.provider_calls === 0 && baseline.local_only === true ? "pass" : "fail",
    result: baseline.result,
    provider_calls: baseline.provider_calls,
    local_only: baseline.local_only,
    deny_by_default: baseline.deny_by_default,
    human_approval_required: baseline.human_approval_required,
    document_exists: baseline.document_exists,
    model_readable: baseline.model_readable
  };
}
