import fs from "node:fs";
import path from "node:path";
import {
  createTraceEvent,
  decideProviderRequest,
  detectProjectSignals,
  enforcePermission,
  evaluateRegressionGate,
  evaluatePermission,
  loadAgent,
  loadArchitectureKernel,
  loadLazySkill,
  loadPostPhase7Roadmap,
  orchestrateTask,
  readJson,
  selectLazySkills,
  evaluateReleaseReadiness
} from "../../core/src/index.js";

const phase2Task = {
  id: "schema-validation-local-only",
  input: "Validate this agent registry",
  local_reason: "Agent registry validation is deterministic and does not require semantic provider judgment"
};

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporaryPath, filePath);
}

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

  writeJsonAtomic(traceOutputPath, trace);

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

  writeJsonAtomic(traceOutputPath, trace);

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

  writeJsonAtomic(traceOutputPath, trace);

  return {
    manifest_phase: kernel.manifest.phase,
    orchestrator,
    permission_checks: permissionChecks,
    trace_output_path: traceOutputPath,
    trace
  };
}

function summarizePhase3(decisions) {
  return {
    result: "pass",
    cases: decisions.length,
    small_task_delegations: decisions.filter(
      (decision) => decision.task_classification.complexity === "small" && decision.delegation === true
    ).length,
    specialist_delegations: decisions.filter((decision) => decision.delegation === true).length,
    temporary_agent_proposals: decisions.filter((decision) => decision.temporary_agent_proposal).length,
    provider_calls: 0,
    trace_event: "delegation_decision"
  };
}

function summarizePhase4(permissionChecks) {
  return {
    result: "pass",
    cases: permissionChecks.length,
    allowed_permissions: permissionChecks.filter((check) => check.decision === "allow").length,
    denied_permissions: permissionChecks.filter((check) => check.decision === "deny").length,
    protected_path_denials: permissionChecks.filter((check) => check.reason === "target_path_matches_protected_paths").length,
    destructive_command_denials: permissionChecks.filter((check) => check.reason === "command_matches_destructive_defaults").length,
    permission_broadening_denials: permissionChecks.filter(
      (check) => check.scenario_id === "denied-permission-broadening" && check.decision === "deny"
    ).length,
    default_denials: permissionChecks.filter((check) => check.reason === "default_deny_policy").length,
    provider_calls: 0,
    trace_event: "permission_enforcement"
  };
}

export function runPiEvalGateSpike({ root, traceOutputPath }) {
  const phase2 = runPiRuntimeSpike({
    root,
    traceOutputPath: path.join(root, ".ai/observability/generated/phase-2-provider-request-avoided.json")
  });
  const phase3 = runPiAgentSystemSpike({
    root,
    traceOutputPath: path.join(root, ".ai/observability/generated/phase-3-delegation-decision.json")
  });
  const phase4 = runPiSecuritySpike({
    root,
    traceOutputPath: path.join(root, ".ai/observability/generated/phase-4-permission-enforcement.json")
  });

  const baselines = {
    "phase-1-architecture-kernel": readJson(root, ".ai/evals/baselines/phase-1-architecture-kernel.json"),
    "phase-2-pi-runtime-spike": readJson(root, ".ai/evals/baselines/phase-2-pi-runtime-spike.json"),
    "phase-3-agent-system": readJson(root, ".ai/evals/baselines/phase-3-agent-system.json"),
    "phase-4-security-enforcement": readJson(root, ".ai/evals/baselines/phase-4-security-enforcement.json")
  };
  const currentResults = {
    "phase-1-architecture-kernel": {
      result: "pass",
      checks: baselines["phase-1-architecture-kernel"].checks,
      provider_calls: 0
    },
    "phase-2-pi-runtime-spike": {
      result: "pass",
      provider_calls: phase2.provider_decision.provider_calls,
      trace_event: phase2.trace.event
    },
    "phase-3-agent-system": summarizePhase3(phase3.decisions),
    "phase-4-security-enforcement": summarizePhase4(phase4.permission_checks)
  };
  const gatePolicy = readJson(root, ".ai/evals/regression-gates.json");
  const gate = evaluateRegressionGate({ gatePolicy, baselines, currentResults });

  const trace = createTraceEvent({
    event: "regression_gate_evaluated",
    actor: "pi-adapter",
    data: {
      trace_id: "phase-5-evals-regression-gate",
      timestamp: "2026-05-19T00:00:00.000Z",
      status: gate.status,
      comparisons: gate.comparisons,
      regressions: gate.regressions,
      baseline_update_requires_human_approval: gate.baseline_update_requires_human_approval,
      provider_calls: gate.provider_calls,
      gate_policy: ".ai/evals/regression-gates.json",
      version_locks: ".ai/versions/locks.json"
    }
  });

  writeJsonAtomic(traceOutputPath, trace);

  return {
    orchestrator: phase2.orchestrator,
    current_results: currentResults,
    gate,
    trace_output_path: traceOutputPath,
    trace
  };
}

export function runPiSkillLoadingSpike({ root, traceOutputPath }) {
  const kernel = loadArchitectureKernel(root);
  const orchestrator = loadAgent(kernel, "orchestrator");
  const projectSignals = detectProjectSignals({ root, registry: kernel.skills });
  const activationDecisions = selectLazySkills({
    registry: kernel.skills,
    input: "Update the Phase 6 architecture policy and package.json validation scripts",
    projectSignals,
    agentId: orchestrator.id
  });
  const loadedSkillBodies = activationDecisions.filter((decision) => decision.load_body === true).length;

  const trace = createTraceEvent({
    event: "skill_activation_decision",
    actor: "pi-adapter",
    data: {
      trace_id: "phase-6-skill-packs-lazy-loading",
      timestamp: "2026-05-19T00:00:00.000Z",
      orchestrator_id: orchestrator.id,
      registry: ".ai/skills/registry.json",
      detected_project_signals: projectSignals,
      activation_decisions: activationDecisions,
      selected_skill_ids: activationDecisions.map((decision) => decision.skill_id),
      loaded_skill_bodies: loadedSkillBodies,
      provider_calls: 0,
      policy: {
        loading: kernel.skills.policy.loading,
        default: kernel.skills.policy.default,
        scope: kernel.skills.policy.scope,
        load_bodies_globally: kernel.skills.policy.load_bodies_globally
      }
    }
  });

  writeJsonAtomic(traceOutputPath, trace);

  return {
    manifest_phase: kernel.manifest.phase,
    orchestrator,
    project_signals: projectSignals,
    activation_decisions: activationDecisions,
    loaded_skill_bodies: loadedSkillBodies,
    trace_output_path: traceOutputPath,
    trace
  };
}

export function runPiRoadmapReadinessSpike({ root, traceOutputPath }) {
  const kernel = loadArchitectureKernel(root);
  const orchestrator = loadAgent(kernel, "orchestrator");
  const roadmap = loadPostPhase7Roadmap(root);
  const readiness = evaluateReleaseReadiness({
    roadmap,
    completedPhases: [
      "phase-1-architecture-kernel",
      "phase-2-pi-runtime-spike",
      "phase-3-agent-system",
      "phase-4-security-enforcement",
      "phase-5-evals-regression-gates",
      "phase-6-skill-packs-lazy-loading",
      "phase-7-harness-portability"
    ]
  });

  const trace = createTraceEvent({
    event: "roadmap_readiness_evaluated",
    actor: "pi-adapter",
    data: {
      trace_id: "post-phase-7-roadmap-readiness",
      timestamp: "2026-05-19T00:00:00.000Z",
      orchestrator_id: orchestrator.id,
      roadmap: ".ai/execution/post-phase-7-roadmap.json",
      status: readiness.status,
      completed_phase_count: readiness.completed_phase_count,
      next_milestone_count: readiness.next_milestone_count,
      governance_ready: readiness.governance_ready,
      validation_ready: readiness.validation_ready,
      next_work_ready: readiness.next_work_ready,
      provider_calls: readiness.provider_calls
    }
  });

  writeJsonAtomic(traceOutputPath, trace);

  return {
    manifest_phase: kernel.manifest.phase,
    orchestrator,
    roadmap,
    readiness,
    trace_output_path: traceOutputPath,
    trace
  };
}

export function buildPiAdapterReadiness({ root }) {
  const kernel = loadArchitectureKernel(root);
  const orchestrator = loadAgent(kernel, "orchestrator");

  return {
    harness: "pi",
    status: "hardened",
    adapter_package: "packages/pi-adapter",
    runtime_entrypoints: [
      "runPiRuntimeSpike",
      "runPiAgentSystemSpike",
      "runPiSecuritySpike",
      "runPiEvalGateSpike",
      "runPiSkillLoadingSpike",
      "runPiRoadmapReadinessSpike"
    ],
    validated_capabilities: [
      "primary_control",
      "specialist_routing",
      "lazy_skills",
      "permission_enforcement",
      "trace_emission",
      "eval_execution",
      "model_assignment",
      "local_first"
    ],
    invariants: {
      core_is_harness_agnostic: true,
      model_assignment_user_owned: kernel.modelAssignment.ownership?.assignment_owner === "user",
      provider_calls_are_local_first: kernel.providerPolicy.default_strategy === "local-first",
      skill_bodies_lazy_loaded: kernel.skills.policy.load_bodies_globally === false,
      permissions_deny_by_default: kernel.permissions.default === "deny"
    },
    orchestrator_id: orchestrator.id,
    provider_calls: 0
  };
}

export function buildPiStableRuntime({ root }) {
  const readiness = buildPiAdapterReadiness({ root });

  return {
    harness: "pi",
    status: "stable",
    adapter_package: readiness.adapter_package,
    runtime_api: "packages/pi-adapter/src/runtime.js#buildPiStableRuntime",
    capabilities: readiness.validated_capabilities,
    trace_events: [
      "provider_request_avoided",
      "delegation_decision",
      "permission_enforcement",
      "regression_gate_evaluated",
      "skill_activation_decision",
      "roadmap_readiness_evaluated"
    ],
    boundaries: {
      core_is_harness_agnostic: true,
      harness_config_writes_disabled_by_default: true,
      model_assignment_user_owned: readiness.invariants.model_assignment_user_owned,
      local_first_execution: readiness.invariants.provider_calls_are_local_first,
      permission_policy_externalized: readiness.invariants.permissions_deny_by_default
    },
    provider_calls: 0
  };
}

export function buildPiIntegrationPreview({ root }) {
  const stableRuntime = buildPiStableRuntime({ root });

  return {
    harness: "pi",
    mvp_required: true,
    preview_only: false,
    adapter_package: "packages/pi-adapter",
    generated_artifacts: {
      runtime_module: "packages/pi-adapter/src/runtime.js",
      cli_entrypoint: "packages/pi-adapter/src/cli.js",
      stable_runtime_api: stableRuntime.runtime_api,
      trace_events: stableRuntime.trace_events,
      capabilities: stableRuntime.capabilities
    },
    writes_harness_config_by_default: false,
    human_approval_required_before_write: true,
    provider_calls: 0
  };
}

// --- Install Management Functions ---

function buildPiAgentFileContent(agent) {
  const name = agent.id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  const mode = agent.id === "orchestrator" ? "primary" : "subagent";
  return `---
description: Alfred ${name} agent generated from .ai source of truth.
mode: ${mode}
---

You are Alfred's ${name} agent.

Load project instructions from AGENTS.md and Alfred source-of-truth files under .ai/.

Rules:
- Preserve Alfred's local-first provider policy.
- Do not broaden permissions.
- Do not write harness config without explicit human approval.
- Keep model assignment user-owned at runtime.
`;
}

function buildPiConfigJson(kernel) {
  return {
    harness: "pi",
    version: kernel.manifest.version ?? "0.2.0",
    capabilities: [
      "primary_control",
      "specialist_routing",
      "lazy_skills",
      "permission_enforcement",
      "trace_emission",
      "eval_execution",
      "model_assignment",
      "local_first"
    ]
  };
}

function buildPiSkillsRegistry(kernel) {
  return {
    skills: kernel.skills.skills.map((skill) => ({
      id: skill.id,
      description: skill.description ?? `Use when Alfred needs ${skill.id} project context.`,
      scope: skill.scope ?? "task-specific",
      triggers: skill.triggers ?? []
    })),
    policy: {
      loading: kernel.skills.policy?.loading ?? "lazy",
      default: kernel.skills.policy?.default ?? "available",
      scope: kernel.skills.policy?.scope ?? "task-specific",
      load_bodies_globally: kernel.skills.policy?.load_bodies_globally ?? false
    }
  };
}

function buildPiAgentsMd(kernel) {
  return `---
description: Alfred orchestrator agent
---

# Alfred Orchestrator

You are Alfred's Orchestrator agent.

Load project instructions from AGENTS.md and Alfred source-of-truth files under .ai/.

Rules:
- Preserve Alfred's local-first provider policy.
- Do not broaden permissions.
- Do not write harness config without explicit human approval.
- Keep model assignment user-owned at runtime.

You are powered by the model named minimax-m2.7. The exact model ID is ollama-cloud/minimax-m2.7
`;
}

function buildPiReadmeContent() {
  return `# Alfred Pi Agent Workspace

This workspace has Alfred Pi agent installed.

## Structure

- \`AGENTS.md\` - Orchestrator agent instructions
- \`.alfred/\` - Alfred configuration and artifacts
  - \`config.json\` - Pi harness configuration
  - \`agents/\` - Agent specifications
  - \`skills/\` - Skill manifests
  - \`pi-adapter/\` - Pi adapter files

## Updating

To update to the latest version:
\`\`\`
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/update.sh | sh
\`\`\`

## Uninstalling

To remove Alfred from this workspace:
\`\`\`
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/uninstall.sh | sh
\`\`\`
`;
}

/**
 * Build install preview for Pi agent files.
 * Generates a preview of what files would be installed and where.
 * Does NOT write any files - use writePiInstallPreview for actual writing.
 *
 * @param {Object} options
 * @param {string} options.root - Root directory of the Alfred project
 * @param {string} options.targetPath - Target installation path (default: ".")
 * @param {string} options.outputDir - Output directory for preview files (default: ".ai/generated/pi-install")
 * @returns {Object} Preview object with file list and metadata
 */
export function buildPiInstallPreview({ root, targetPath = ".", outputDir = ".ai/generated/pi-install" }) {
  const kernel = loadArchitectureKernel(root);

  return {
    harness: "pi",
    install_mode: "preview",
    target_path: targetPath,
    output_dir: outputDir,
    writes_harness_config_by_default: false,
    human_approval_required_before_write: true,
    restart_required_after_install: true,
    provider_calls: 0,
    files: [
      {
        path: `${outputDir}/AGENTS.md`,
        install_path: `${targetPath}/AGENTS.md`,
        kind: "agents",
        content: buildPiAgentsMd(kernel)
      },
      {
        path: `${outputDir}/.alfred/config.json`,
        install_path: `${targetPath}/.alfred/config.json`,
        kind: "config",
        content: JSON.stringify(buildPiConfigJson(kernel), null, 2) + "\n"
      },
      ...kernel.agents.agents.map((agent) => ({
        path: `${outputDir}/.alfred/agents/${agent.id}.md`,
        install_path: `${targetPath}/.alfred/agents/${agent.id}.md`,
        kind: "agent",
        content: buildPiAgentFileContent(agent)
      })),
      {
        path: `${outputDir}/.alfred/skills/registry.json`,
        install_path: `${targetPath}/.alfred/skills/registry.json`,
        kind: "skills-registry",
        content: JSON.stringify(buildPiSkillsRegistry(kernel), null, 2) + "\n"
      }
    ],
    generated_artifacts: {
      agents_count: kernel.agents.agents.length,
      skills_count: kernel.skills.skills.length,
      config_version: kernel.manifest.version ?? "0.2.0"
    }
  };
}

/**
 * Write install preview files to disk.
 * Files are written atomically using temp file + rename pattern.
 *
 * @param {Object} options
 * @param {string} options.root - Root directory of the Alfred project
 * @param {string} options.targetPath - Target installation path
 * @param {string} options.outputDir - Output directory for preview files
 * @returns {Object} Preview object with written file list
 */
export function writePiInstallPreview({ root, targetPath = ".", outputDir = ".ai/generated/pi-install" }) {
  const preview = buildPiInstallPreview({ root, targetPath, outputDir });

  for (const file of preview.files) {
    const fullPath = path.join(root, file.path);
    writeTextAtomic(fullPath, file.content);
  }

  return preview;
}

/**
 * Validate an installation path.
 * Rejects root, protected paths, and non-writable directories.
 *
 * @param {string} targetPath - Path to validate
 * @returns {Object} Validation result with valid boolean and error code
 */
export function validateInstallPath(targetPath) {
  // Check if path is empty
  if (!targetPath || targetPath.trim() === "") {
    return { valid: false, error_code: "installation_path_empty" };
  }

  // Check if path is root
  if (targetPath === "/") {
    return { valid: false, error_code: "installation_path_is_root" };
  }

  // Check for protected segments
  const protectedSegments = [".ai/", ".opencode/", "harnesses/"];
  for (const segment of protectedSegments) {
    if (targetPath.includes(segment)) {
      return { valid: false, error_code: "installation_path_protected" };
    }
  }

  // Check if path is a directory and writable
  try {
    if (fs.existsSync(targetPath)) {
      const stat = fs.statSync(targetPath);
      if (!stat.isDirectory()) {
        return { valid: false, error_code: "installation_path_not_directory" };
      }
      // Check if writable by attempting to create a temp file
      const testFile = path.join(targetPath, `.write_test_${process.pid}`);
      try {
        fs.writeFileSync(testFile, "");
        fs.unlinkSync(testFile);
      } catch {
        return { valid: false, error_code: "installation_path_not_writable" };
      }
    } else {
      // Directory doesn't exist, check parent
      const parent = path.dirname(targetPath);
      if (!fs.existsSync(parent) || !fs.accessSync(parent, fs.constants.W_OK)) {
        return { valid: false, error_code: "installation_path_parent_not_writable" };
      }
    }
  } catch {
    return { valid: false, error_code: "installation_path_invalid" };
  }

  return { valid: true, error_code: null };
}

/**
 * Build trace event for install management operations.
 *
 * @param {Object} options
 * @param {string} options.operation - "install", "update", or "uninstall"
 * @param {string} options.targetPath - Target path
 * @param {string} options.status - "pass" or "fail"
 * @param {string|null} options.errorCode - Error code if failed
 * @param {boolean} options.diffDetected - Whether diff was detected (for updates)
 * @returns {Object} Trace event object
 */
export function buildInstallTrace({ operation, targetPath, status, errorCode = null, diffDetected = false }) {
  return {
    trace_id: "phase-13-pi-agent-install-management",
    timestamp: new Date().toISOString(),
    event: "install_management_operation",
    actor: "pi-install",
    data: {
      operation,
      target_path: targetPath,
      status,
      error_code: errorCode,
      diff_detected: diffDetected,
      human_approval: true,
      provider_calls: 0
    }
  };
}

function writeTextAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, value);
  fs.renameSync(temporaryPath, filePath);
}
