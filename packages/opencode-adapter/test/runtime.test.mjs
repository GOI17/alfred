import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildOpencodeAdapterPreview,
  buildOpencodeInstallPreview,
  writeOpencodeInstallPreview
} from "../src/runtime.js";
import { loadArchitectureKernel } from "../../core/src/index.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));

function loadKernel() {
  return loadArchitectureKernel(root);
}

test("opencode preview emits current plural agent paths", () => {
  const preview = buildOpencodeAdapterPreview({ kernel: loadKernel() });
  assert.equal(preview.harness, "opencode");
  assert.equal(preview.generated_artifacts.agents.length, 6);
  for (const agent of preview.generated_artifacts.agents) {
    assert.match(agent.path, /^\.opencode\/agents\/[a-z-]+\.md$/);
    assert.doesNotMatch(agent.path, /^\.opencode\/agent\//);
  }
});

test("opencode install preview maps files to installable opencode agent artifacts", () => {
  const preview = buildOpencodeInstallPreview({ root, outputDir: ".ai/generated/test-opencode-install" });
  const agents = preview.files.filter((file) => file.kind === "agent");
  assert.equal(agents.length, 6);
  assert.ok(agents.every((file) => file.install_path.startsWith(".opencode/agents/")));
  const developer = agents.find((file) => file.install_path === ".opencode/agents/developer.md");
  assert.ok(developer);
  assert.match(developer.content, /Mission: implement scoped code changes under policy\./);
  assert.match(developer.content, /Alfred source agent spec \(\.ai\/agents\/developer\.md\):/);
});

test("opencode config preview keeps permission gates conservative", () => {
  const preview = buildOpencodeInstallPreview({ root, outputDir: ".ai/generated/test-opencode-install" });
  const config = preview.files.find((file) => file.install_path === "opencode.json");
  assert.ok(config);
  const parsed = JSON.parse(config.content);
  assert.equal(parsed.default_agent, "orchestrator");
  assert.equal(parsed.permission.edit, "ask");
  assert.equal(parsed.permission.bash["rm *"], "deny");
  assert.equal(parsed.permission.external_directory["**/.ssh/**"], "deny");
  assert.equal(parsed.permission.skill["*"], "ask");
});

test("writeOpencodeInstallPreview writes only preview files under requested output dir", () => {
  const outputDir = `.ai/generated/test-opencode-install-${process.pid}`;
  try {
    const preview = writeOpencodeInstallPreview({ root, outputDir });
    const orchestrator = preview.files.find((file) => file.install_path === ".opencode/agents/orchestrator.md");
    assert.ok(orchestrator);
    const writtenPath = join(root, orchestrator.path);
    assert.ok(existsSync(writtenPath));
    assert.match(readFileSync(writtenPath, "utf8"), /# Orchestrator/);
  } finally {
    rmSync(join(root, outputDir), { recursive: true, force: true });
  }
});
