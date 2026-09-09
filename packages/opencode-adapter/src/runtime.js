import fs from "node:fs";
import path from "node:path";
import {
  compactContext,
  createTraceEvent,
  detectContextUsage,
  evaluateHarnessPortability,
  loadAgent,
  loadArchitectureKernel,
  loadHarnessCompatibility,
  resolveProjectIdentity,
  resolveThreshold
} from "../../core/src/index.js";

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporaryPath, filePath);
}

function toOpencodeAgent(agent) {
  return {
    path: `.opencode/agents/${agent.id}.md`,
    mode: agent.id === "orchestrator" ? "primary" : "subagent",
    description: agent.description,
    permission: "mapped-from-alfred-permission-policy"
  };
}

function toTitle(value) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveSourceRoot(root) {
  // A task worktree owns its checked-out canonical instructions. Retain the
  // shared project fallback for installation views that contain no .ai source.
  return fs.existsSync(path.join(root, ".ai/manifest.json"))
    ? root
    : resolveProjectIdentity(root).project_root;
}

function readSourceText(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").trim();
}

function readSourceMarkdownBody(root, relativePath) {
  return readSourceText(root, relativePath)
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .trim();
}


function quoteMarkdownSource(sourceSpec) {
  return sourceSpec
    .split("\n")
    .map((line) => line ? `> ${line}` : ">")
    .join("\n");
}

const SPECIALIST_ROLE_SCOPES = {
  developer: "Developer implements authorized changes.",
  architect: "Architect handles architecture, DDD, and pattern decisions.",
  qa: "QA handles testing, regression coverage design, and bug verification.",
  reviewer: "Reviewer handles code review and policy enforcement.",
  librarian: "Librarian searches, reads, summarizes, and indexes knowledge without writing files."
};

function buildRoleInstructions(agent) {
  if (agent.id === "orchestrator") {
    return `## Routing table (execute before any action)

- Before delegating a repository-writing task, apply the canonical repository write isolation policy below and pass the verified task worktree context.
- **STOP-and-delegate rule**: if you are about to write, edit, refactor, or delete application code, stop and delegate to the \`developer\` agent. You must not modify code yourself.
- Route implementation/coding work to the \`developer\` agent.
- Route architecture/DDD/pattern decisions to the \`architect\` agent.
- Route testing design, regression coverage, and bug verification to the \`qa\` agent.
- Route code review and policy enforcement to the \`reviewer\` agent.
- Route documentation and skill loading to the \`librarian\` agent.
- Emit trace events for classification, delegation, skill loading, permission checks, and provider request decisions.`;
  }

  const roleScope = SPECIALIST_ROLE_SCOPES[agent.id];
  if (!roleScope) throw new Error(`Missing specialist role scope for ${agent.id}`);

  return `## Specialist role boundary

- Retain your assigned specialist role from the canonical specification below: ${roleScope}
- Orchestrator routing and its STOP-and-delegate rule are scoped to the primary Orchestrator, not delegated specialists.
- Perform only delegated tasks allowed by your own role and existing approvals.
- Return out-of-scope work to your parent with the requested next role.
- There is no self-delegation or nested Task availability requirement. Do not simulate unavailable tasks or escalate permissions.
- This role boundary does not override security, shared or inherited permission constraints, approval requirements, or higher-priority restrictions.`;
}

function buildGeneratedAgentRules(agent) {
  const sharedRules = `- Preserve Alfred's local-first provider policy.
- Do not broaden permissions.
- Do not write harness config without explicit human approval.
- Honor protected paths and all higher-priority security and approval requirements.
- Keep model assignment user-owned at runtime.`;

  if (agent.id !== "orchestrator") {
    return `${sharedRules}
- Emit trace events for classification, skill loading, permission checks, and provider request decisions.`;
  }

  return `${sharedRules}
- **STOP-and-delegate rule**: if you are about to write, edit, refactor, or delete application code, stop and delegate to the \`developer\` agent. You must not modify code yourself.
- Route implementation/coding work to the \`developer\` agent.
- Route architecture/DDD/pattern decisions to the \`architect\` agent.
- Route testing design, regression coverage, and bug verification to the \`qa\` agent.
- Route code review and policy enforcement to the \`reviewer\` agent.
- Route documentation and skill loading to the \`librarian\` agent.
- Emit trace events for classification, delegation, skill loading, permission checks, and provider request decisions.`;
}


function buildAgentFileContent({ root, agent, primaryModel }) {
  const mode = agent.id === "orchestrator" ? "primary" : "subagent";
  const sourceSpec = readSourceText(root, agent.spec);
  return `---
description: Alfred ${toTitle(agent.id)} agent generated from .ai source of truth.
mode: ${mode}
${primaryModel ? `model: ${JSON.stringify(primaryModel)}\n` : ""}permission:
  edit: ask
  bash: ask
---

You are Alfred's ${toTitle(agent.id)} agent.

Load project instructions from AGENTS.md and Alfred source-of-truth files under .ai/.


${buildRoleInstructions(agent)}


Alfred source agent spec (${agent.spec}), quoted to avoid nested frontmatter parsing:

${quoteMarkdownSource(sourceSpec)}


Rules:
${buildGeneratedAgentRules(agent)}
`;
}

function buildSkillFileContent({ root, skill }) {
  const name = skill.id;
  const description = skill.description ?? `Use when Alfred needs ${name} project context.`;
  const body = readSourceMarkdownBody(root, skill.bodyPath);
  return `---
name: ${name}
description: ${description}
---

${body}
`;
}

function normalizeModelAssignments(modelAssignments = []) {
  const entries = Array.isArray(modelAssignments)
    ? modelAssignments.map((assignment) => [assignment?.agent_id, assignment])
    : modelAssignments && typeof modelAssignments === "object"
      ? Object.entries(modelAssignments)
      : [];
  const normalized = new Map();

  for (const [agentId, assignment] of entries) {
    const normalizedAgentId = typeof agentId === "string" ? agentId.trim() : "";
    const primary = typeof assignment?.primary === "string" ? assignment.primary.trim() : "";
    if (normalizedAgentId && primary) {
      normalized.set(normalizedAgentId, primary);
    }
  }

  return normalized;
}

export function buildOpencodeJsonPreview() {
  return {
    $schema: "https://opencode.ai/config.json",
    default_agent: "orchestrator",
    instructions: ["AGENTS.md"],
    permission: {
      edit: "ask",
      bash: {
        "*": "ask",
        "rm *": "deny",
        "git reset --hard*": "deny",
        "git clean*": "deny"
      },
      external_directory: {
        "*": "ask",
        "**/.env*": "deny",
        "**/secrets/**": "deny",
        "**/.ssh/**": "deny"
      },
      skill: {
        "*": "ask"
      }
    }
  };
}

function writeTextAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, value);
  fs.renameSync(temporaryPath, filePath);
}

function toOpencodeSkill(skill) {
  return {
    path: `.opencode/skills/${skill.id}/SKILL.md`,
    source_body_path: skill.bodyPath,
    load_body_by_default: false,
    scope: skill.scope
  };
}

function toOpencodePermissions(permissions) {
  return {
    default: permissions.default,
    edit: "ask",
    bash: {
      "*": "ask",
      "rm *": "deny",
      "git reset --hard*": "deny",
      "git clean*": "deny"
    },
    external_directory: {
      "*": "ask",
      "**/.env*": "deny",
      "**/secrets/**": "deny",
      "**/.ssh/**": "deny"
    }
  };
}

export function buildOpencodeAdapterPreview({ kernel }) {
  const orchestrator = loadAgent(kernel, "orchestrator");
  return {
    harness: "opencode",
    generated_artifacts: {
      agents: kernel.agents.agents.map(toOpencodeAgent),
      skills: kernel.skills.skills.map(toOpencodeSkill),
      permissions: toOpencodePermissions(kernel.permissions)
    },
    invariants: {
      core_imports_opencode: false,
      model_assignment_user_owned: true,
      skill_bodies_loaded_by_default: false,
      permission_policy_source: ".ai/policies/permissions.example.json",
      local_first_policy_source: ".ai/policies/provider-request-policy.example.json"
    },
    orchestrator
  };
}

export function runOpencodePortabilitySpike({ root, traceOutputPath }) {
  const kernel = loadArchitectureKernel(root);
  const matrix = loadHarnessCompatibility(root);
  const portability = evaluateHarnessPortability({ matrix });
  const preview = buildOpencodeAdapterPreview({ kernel });
  const opencodeResult = portability.harnesses.find((harness) => harness.harness_id === "opencode");

  const trace = createTraceEvent({
    event: "harness_portability_evaluated",
    actor: "opencode-adapter",
    data: {
      trace_id: "phase-7-harness-portability",
      timestamp: "2026-05-19T00:00:00.000Z",
      matrix: ".ai/harnesses/compatibility-matrix.json",
      portability_status: portability.status,
      required_harnesses: portability.required_harnesses,
      portable_harnesses: portability.portable_harnesses,
      opencode_adapter_status: opencodeResult.adapter_status,
      opencode_capabilities: opencodeResult.capability_results,
      generated_artifacts: preview.generated_artifacts,
      invariants: preview.invariants,
      provider_calls: 0
    }
  });

  writeJsonAtomic(traceOutputPath, trace);

  return {
    orchestrator: preview.orchestrator,
    portability,
    opencode: opencodeResult,
    preview,
    trace_output_path: traceOutputPath,
    trace
  };
}

export function buildOpencodeAdapterReadiness({ root }) {
  const kernel = loadArchitectureKernel(root);
  const preview = buildOpencodeAdapterPreview({ kernel });

  return {
    harness: "opencode",
    status: "hardened",
    adapter_package: "packages/opencode-adapter",
    runtime_entrypoints: ["buildOpencodeAdapterPreview", "runOpencodePortabilitySpike", "buildOpencodeAdapterReadiness"],
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
    generated_artifact_counts: {
      agents: preview.generated_artifacts.agents.length,
      skills: preview.generated_artifacts.skills.length
    },
    invariants: {
      core_is_harness_agnostic: preview.invariants.core_imports_opencode === false,
      model_assignment_user_owned: preview.invariants.model_assignment_user_owned === true,
      provider_calls_are_local_first: preview.invariants.local_first_policy_source === ".ai/policies/provider-request-policy.example.json",
      skill_bodies_lazy_loaded: preview.invariants.skill_bodies_loaded_by_default === false,
      permissions_deny_by_default: preview.generated_artifacts.permissions.default === "deny"
    },
    provider_calls: 0
  };
}

export async function runContextCompactionHook({ root, messages, mode = "local-only" }) {
  const projectIdentity = resolveProjectIdentity(root);
  const usage = detectContextUsage({ messages });
  const threshold = resolveThreshold({ model_context: usage.model_context, projectIdentity });
  const shouldCompact = usage.current_tokens >= threshold.threshold_tokens;

  if (!shouldCompact) {
    return {
      compacted: false,
      summary_messages: messages,
      provider_calls: 0,
      trace_events: []
    };
  }

  const targetTokens = threshold.threshold_tokens;
  const compaction = await compactContext({
    messages,
    targetTokens,
    projectIdentity,
    mode,
    approval: false
  });

  return {
    compacted: true,
    summary_messages: compaction.summary_messages,
    provider_calls: compaction.provider_calls,
    trace_events: compaction.trace_events
  };
}

export function buildOpencodeStableRuntime({ root }) {
  const readiness = buildOpencodeAdapterReadiness({ root });

  return {
    harness: "opencode",
    status: "stable",
    adapter_package: readiness.adapter_package,
    runtime_api: "packages/opencode-adapter/src/runtime.js#buildOpencodeStableRuntime",
    capabilities: readiness.validated_capabilities,
    trace_events: [
      "provider_request_avoided",
      "harness_portability_evaluated",
      "adapter_artifact_previewed",
      "context_compaction_triggered"
    ],
    boundaries: {
      core_is_harness_agnostic: true,
      harness_config_writes_disabled_by_default: true,
      model_assignment_user_owned: readiness.invariants.model_assignment_user_owned,
      local_first_execution: readiness.invariants.provider_calls_are_local_first,
      permission_policy_externalized: readiness.invariants.permissions_deny_by_default
    },
    generated_artifact_counts: readiness.generated_artifact_counts,
    provider_calls: 0
  };
}

export function buildOpencodeIntegrationPreview({ root }) {
  const kernel = loadArchitectureKernel(root);
  const preview = buildOpencodeAdapterPreview({ kernel });
  const stableRuntime = buildOpencodeStableRuntime({ root });

  return {
    harness: "opencode",
    mvp_required: true,
    preview_only: false,
    adapter_package: "packages/opencode-adapter",
    generated_artifacts: {
      agents: preview.generated_artifacts.agents,
      skills: preview.generated_artifacts.skills,
      permissions: preview.generated_artifacts.permissions,
      stable_runtime_api: stableRuntime.runtime_api
    },
    writes_harness_config_by_default: false,
    human_approval_required_before_write: true,
    provider_calls: 0
  };
}

export function buildOpencodeInstallPreview({
  root,
  outputDir = ".ai/generated/opencode-install",
  projectRoot = resolveSourceRoot(root),
  modelAssignments = []
}) {
  const kernel = loadArchitectureKernel(projectRoot);
  const integration = buildOpencodeIntegrationPreview({ root: projectRoot });
  const relativeOutputDir = outputDir;
  const normalizedModelAssignments = normalizeModelAssignments(modelAssignments);

  return {
    harness: "opencode",
    install_mode: "preview",
    output_dir: relativeOutputDir,
    target_dir: ".opencode",
    writes_harness_config_by_default: false,
    human_approval_required_before_write: true,
    restart_required_after_install: true,
    provider_calls: 0,
    files: [
      {
        path: `${relativeOutputDir}/opencode.json.preview`,
        install_path: "opencode.json",
        kind: "config",
        content: `${JSON.stringify(buildOpencodeJsonPreview(), null, 2)}\n`
      },
      ...kernel.agents.agents.map((agent) => ({
        path: `${relativeOutputDir}/.opencode/agents/${agent.id}.md`,
        install_path: `.opencode/agents/${agent.id}.md`,
        kind: "agent",
        content: buildAgentFileContent({ root: projectRoot, agent, primaryModel: normalizedModelAssignments.get(agent.id) })
      })),
      ...kernel.skills.skills.map((skill) => ({
        path: `${relativeOutputDir}/.opencode/skills/${skill.id}/SKILL.md`,
        install_path: `.opencode/skills/${skill.id}/SKILL.md`,
        kind: "skill",
        content: buildSkillFileContent({ root: projectRoot, skill })
      }))
    ],
    generated_artifacts: integration.generated_artifacts
  };
}

export function writeOpencodeInstallPreview({
  root,
  outputDir = ".ai/generated/opencode-install",
  projectRoot = resolveSourceRoot(root),
  modelAssignments = []
}) {
  const preview = buildOpencodeInstallPreview({ root, outputDir, projectRoot, modelAssignments });
  for (const file of preview.files) {
    writeTextAtomic(path.join(root, file.path), file.content);
  }
  return preview;
}
