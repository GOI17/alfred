import fs from "node:fs";
import path from "node:path";
import { createTraceEvent, loadArchitectureKernel } from "../../core/src/index.js";

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporaryPath, filePath);
}

export function buildVscodeIntegrationPreview({ root }) {
  const kernel = loadArchitectureKernel(root);

  return {
    harness: "vscode",
    mvp_required: true,
    preview_only: false,
    adapter_package: "packages/vscode-adapter",
    generated_artifacts: {
      extension_manifest: {
        path: ".vscode/extensions/alfred/package.json.preview",
        contributes: ["commands", "configuration", "taskDefinitions"],
        activation_events: ["onCommand:alfred.run", "workspaceContains:.ai/manifest.json"]
      },
      commands: [
        { command: "alfred.run", title: "Alfred: Run Orchestrator" },
        { command: "alfred.eval", title: "Alfred: Run Local Evals" },
        { command: "alfred.previewHarnessArtifacts", title: "Alfred: Preview Harness Artifacts" }
      ],
      settings: {
        "alfred.root": ".",
        "alfred.providerCallsAllowed": 0,
        "alfred.requireApprovalBeforeConfigWrite": true
      },
      agents: kernel.agents.agents.map((agent) => ({ id: agent.id, role: agent.role, description: agent.description })),
      skills: kernel.skills.skills.map((skill) => ({ id: skill.id, scope: skill.scope, load_body_by_default: false }))
    },
    writes_harness_config_by_default: false,
    human_approval_required_before_write: true,
    provider_calls: 0
  };
}

export function runVscodeIntegrationPreview({ root, traceOutputPath }) {
  const preview = buildVscodeIntegrationPreview({ root });
  const trace = createTraceEvent({
    event: "adapter_artifact_previewed",
    actor: "vscode-adapter",
    data: {
      trace_id: "vscode-integration-preview",
      timestamp: "2026-05-19T00:00:00.000Z",
      harness: preview.harness,
      mvp_required: preview.mvp_required,
      generated_artifacts: preview.generated_artifacts,
      writes_harness_config_by_default: preview.writes_harness_config_by_default,
      human_approval_required_before_write: preview.human_approval_required_before_write,
      provider_calls: preview.provider_calls
    }
  });

  writeJsonAtomic(traceOutputPath, trace);

  return { preview, trace_output_path: traceOutputPath, trace };
}
