import fs from "node:fs";
import path from "node:path";
import { loadArchitectureKernel } from "../../core/src/index.js";

function writeTextAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, value);
  fs.renameSync(temporaryPath, filePath);
}

function toTitle(value) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function tomlStringArray(values) {
  return `[${values.map((value) => tomlString(value)).join(", ")}]`;
}

function readSourceText(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").trim();
}

function buildCodexDeveloperInstructions({ root, agent }) {
  const sourceSpec = readSourceText(root, agent.spec);
  return [
    `You are Alfred's ${toTitle(agent.id)} custom Codex agent.`,
    "",
    "Load and obey the repository AGENTS.md instruction chain before doing work.",
    `Preserve this Alfred source-of-truth agent spec from ${agent.spec}:`,
    "",
    sourceSpec,
    "",
    "Codex runtime rules:",
    "- Use this custom agent only when the parent Codex session explicitly delegates or spawns it.",
    "- Inherit the parent session sandbox and approval policy; never broaden permissions.",
    "- Keep model selection user-owned; this file intentionally does not set model or reasoning defaults.",
    "- Prefer deterministic local checks before any provider request and keep provider calls observable.",
    "- Do not update eval baselines, promote temporary agents, or write harness config without explicit human approval."
  ].join("\n");
}

function toCodexAgentArtifact({ root, agent }) {
  const description = agent.description ?? `Alfred ${toTitle(agent.id)} agent generated from .ai source of truth.`;
  return {
    path: `.codex/agents/${agent.id}.toml`,
    name: agent.id,
    description,
    developer_instructions: buildCodexDeveloperInstructions({ root, agent }),
    nickname_candidates: [toTitle(agent.id)]
  };
}

function buildCodexAgentToml(agentArtifact) {
  return [
    `name = ${tomlString(agentArtifact.name)}`,
    `description = ${tomlString(agentArtifact.description)}`,
    `developer_instructions = ${tomlString(agentArtifact.developer_instructions)}`,
    `nickname_candidates = ${tomlStringArray(agentArtifact.nickname_candidates)}`,
    ""
  ].join("\n");
}

function toCodexSkill(skill) {
  return {
    path: `.agents/skills/${skill.id}/SKILL.md`,
    source_body_path: skill.bodyPath,
    load_body_by_default: false,
    scope: skill.scope,
    description: skill.description ?? `Use when Alfred needs ${skill.id} project context.`
  };
}

function buildCodexSkillFileContent(skill) {
  const name = skill.id;
  const description = skill.description ?? `Use when Alfred needs ${name} project context.`;
  return `---
name: ${name}
description: ${description}
---

# ${toTitle(name)}

This Codex skill is generated from Alfred metadata.

Source body: ${skill.bodyPath}

Rules:
- Load only when the task matches the skill description, trigger words, or explicit $${name} invocation.
- Preserve progressive disclosure: do not paste the source body into global instructions.
- Do not override Alfred security, provider request, or baseline-update policy.
- Keep provider calls local-first and observable.
`;
}

export function buildCodexAdapterPreview({ root, kernel }) {
  const resolvedKernel = kernel ?? loadArchitectureKernel(root);
  const agents = resolvedKernel.agents.agents.map((agent) => toCodexAgentArtifact({ root, agent }));
  const skills = resolvedKernel.skills.skills.map(toCodexSkill);

  return {
    harness: "codex",
    mvp_required: true,
    preview_only: false,
    adapter_package: "packages/codex-adapter",
    generated_artifacts: {
      agents: agents.map(({ path, name, description, nickname_candidates }) => ({ path, name, description, nickname_candidates })),
      skills,
      instructions: {
        path: "AGENTS.md",
        discovery: "codex-instruction-chain"
      }
    },
    invariants: {
      core_imports_codex: false,
      custom_agents_path: ".codex/agents/*.toml",
      repo_skills_path: ".agents/skills/*/SKILL.md",
      model_assignment_source: "user-owned-runtime-configuration",
      skill_bodies_loaded_by_default: false,
      permission_policy_source: ".ai/policies/permissions.example.json",
      local_first_policy_source: ".ai/policies/provider-request-policy.example.json"
    },
    writes_harness_config_by_default: false,
    human_approval_required_before_write: true,
    provider_calls: 0
  };
}

export function buildCodexAdapterReadiness({ root }) {
  const kernel = loadArchitectureKernel(root);
  const preview = buildCodexAdapterPreview({ root, kernel });

  return {
    harness: "codex",
    status: "hardened",
    adapter_package: "packages/codex-adapter",
    runtime_entrypoints: ["buildCodexAdapterPreview", "buildCodexAdapterReadiness", "buildCodexInstallPreview"],
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
      core_is_harness_agnostic: true,
      model_assignment_user_owned: preview.invariants.model_assignment_source === "user-owned-runtime-configuration",
      provider_calls_are_local_first: preview.invariants.local_first_policy_source === ".ai/policies/provider-request-policy.example.json",
      skill_bodies_lazy_loaded: preview.invariants.skill_bodies_loaded_by_default === false,
      permissions_deny_by_default: kernel.permissions.default === "deny"
    },
    provider_calls: 0
  };
}

export function buildCodexStableRuntime({ root }) {
  const readiness = buildCodexAdapterReadiness({ root });

  return {
    harness: "codex",
    status: "stable",
    adapter_package: readiness.adapter_package,
    runtime_api: "packages/codex-adapter/src/runtime.js#buildCodexStableRuntime",
    capabilities: readiness.validated_capabilities,
    trace_events: ["provider_request_avoided", "adapter_artifact_previewed"],
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

export function buildCodexIntegrationPreview({ root }) {
  const kernel = loadArchitectureKernel(root);
  const preview = buildCodexAdapterPreview({ root, kernel });
  const stableRuntime = buildCodexStableRuntime({ root });

  return {
    harness: "codex",
    mvp_required: true,
    preview_only: false,
    adapter_package: "packages/codex-adapter",
    generated_artifacts: {
      agents: preview.generated_artifacts.agents,
      skills: preview.generated_artifacts.skills,
      instructions: preview.generated_artifacts.instructions,
      stable_runtime_api: stableRuntime.runtime_api
    },
    writes_harness_config_by_default: false,
    human_approval_required_before_write: true,
    provider_calls: 0
  };
}

export function buildCodexInstallPreview({ root, outputDir = ".ai/generated/codex-install" }) {
  const kernel = loadArchitectureKernel(root);
  const agentArtifacts = kernel.agents.agents.map((agent) => toCodexAgentArtifact({ root, agent }));
  const skillArtifacts = kernel.skills.skills.map(toCodexSkill);

  return {
    harness: "codex",
    install_mode: "preview",
    output_dir: outputDir,
    target_dirs: [".codex/agents", ".agents/skills"],
    writes_harness_config_by_default: false,
    human_approval_required_before_write: true,
    restart_required_after_install: true,
    provider_calls: 0,
    files: [
      ...agentArtifacts.map((agentArtifact) => ({
        path: `${outputDir}/${agentArtifact.path}`,
        install_path: agentArtifact.path,
        kind: "agent",
        content: buildCodexAgentToml(agentArtifact)
      })),
      ...skillArtifacts.map((skillArtifact) => {
        const sourceSkill = kernel.skills.skills.find((candidate) => candidate.id === skillArtifact.path.split("/").at(-2));
        return {
          path: `${outputDir}/${skillArtifact.path}`,
          install_path: skillArtifact.path,
          kind: "skill",
          content: buildCodexSkillFileContent(sourceSkill)
        };
      })
    ],
    generated_artifacts: buildCodexAdapterPreview({ root, kernel }).generated_artifacts
  };
}

export function writeCodexInstallPreview({ root, outputDir = ".ai/generated/codex-install" }) {
  const preview = buildCodexInstallPreview({ root, outputDir });
  for (const file of preview.files) {
    writeTextAtomic(path.join(root, file.path), file.content);
  }
  return preview;
}
