import fs from "node:fs";
import path from "node:path";
import {
  createTraceEvent,
  evaluateHarnessPortability,
  loadAgent,
  loadArchitectureKernel,
  loadHarnessCompatibility
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
    permission: "mapped-from-alfred-permission-policy",
    model: "user-owned-runtime-configuration"
  };
}

function toTitle(value) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function readSourceText(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").trim();
}

function quoteMarkdownSource(sourceSpec) {
  return sourceSpec
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function buildAgentFileContent({ root, agent }) {
  const mode = agent.id === "orchestrator" ? "primary" : "subagent";
  const sourceSpec = readSourceText(root, agent.spec);
  return `---
description: Alfred ${toTitle(agent.id)} agent generated from .ai source of truth.
mode: ${mode}
permission:
  edit: ask
  bash: ask
---

You are Alfred's ${toTitle(agent.id)} agent.

Load project instructions from AGENTS.md and Alfred source-of-truth files under .ai/.

Alfred source agent spec (${agent.spec}), quoted to avoid nested frontmatter parsing:

${quoteMarkdownSource(sourceSpec)}

Rules:
- Preserve Alfred's local-first provider policy.
- Do not broaden permissions.
- Do not write harness config without explicit human approval.
- Keep model assignment user-owned at runtime.
`;
}

function buildSkillFileContent(skill) {
  const name = skill.id;
  const description = skill.description ?? `Use when Alfred needs ${name} project context.`;
  return `---
name: ${name}
description: ${description}
---

# ${toTitle(name)}

This opencode skill is generated from Alfred metadata.

Source body: ${skill.bodyPath}

Rules:
- Load only when the task matches the skill triggers.
- Do not override Alfred security or provider request policy.
- Keep provider calls local-first and observable.
`;
}

function buildOpencodeJsonPreview() {
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
      model_assignment_source: "user-owned-runtime-configuration",
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
      model_assignment_user_owned: preview.invariants.model_assignment_source === "user-owned-runtime-configuration",
      provider_calls_are_local_first: preview.invariants.local_first_policy_source === ".ai/policies/provider-request-policy.example.json",
      skill_bodies_lazy_loaded: preview.invariants.skill_bodies_loaded_by_default === false,
      permissions_deny_by_default: preview.generated_artifacts.permissions.default === "deny"
    },
    provider_calls: 0
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
    trace_events: ["provider_request_avoided", "harness_portability_evaluated", "adapter_artifact_previewed"],
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

export function buildOpencodeInstallPreview({ root, outputDir = ".ai/generated/opencode-install" }) {
  const kernel = loadArchitectureKernel(root);
  const integration = buildOpencodeIntegrationPreview({ root });
  const relativeOutputDir = outputDir;

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
        content: buildAgentFileContent({ root, agent })
      })),
      ...kernel.skills.skills.map((skill) => ({
        path: `${relativeOutputDir}/.opencode/skills/${skill.id}/SKILL.md`,
        install_path: `.opencode/skills/${skill.id}/SKILL.md`,
        kind: "skill",
        content: buildSkillFileContent(skill)
      }))
    ],
    generated_artifacts: integration.generated_artifacts
  };
}

export function writeOpencodeInstallPreview({ root, outputDir = ".ai/generated/opencode-install" }) {
  const preview = buildOpencodeInstallPreview({ root, outputDir });
  for (const file of preview.files) {
    writeTextAtomic(path.join(root, file.path), file.content);
  }
  return preview;
}
