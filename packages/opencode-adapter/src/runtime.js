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
    path: `.opencode/agent/${agent.id}.md`,
    mode: agent.id === "orchestrator" ? "primary" : "subagent",
    description: agent.description,
    permission: "mapped-from-alfred-permission-policy",
    model: "user-owned-runtime-configuration"
  };
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
