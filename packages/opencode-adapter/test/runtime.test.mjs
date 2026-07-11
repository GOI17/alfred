import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { execFileSync } from "node:child_process";

import {
  buildOpencodeAdapterPreview,
  buildOpencodeInstallPreview,
  writeOpencodeInstallPreview,
  runContextCompactionHook
} from "../src/runtime.js";
import { loadArchitectureKernel } from "../../core/src/index.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));

function tmp(prefix) {
  return mkdtempSync(join(os.tmpdir(), prefix));
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

function writeJson(filePath, value) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function buildAlfredTree(targetRoot) {
  writeJson(join(targetRoot, ".ai/manifest.json"), {
    name: "alfred-worktree-test",
    phase: "phase-12-docs-foundation",
    status: "complete",
    source_of_truth: { agent_system: ".ai" }
  });
  writeJson(join(targetRoot, ".ai/agents/registry.json"), {
    agents: [
      {
        id: "orchestrator",
        mode: "primary",
        description: "Test orchestrator.",
        spec: ".ai/agents/orchestrator.md"
      }
    ]
  });
  writeFileSync(join(targetRoot, ".ai/agents/orchestrator.md"), "---\nid: orchestrator\n---\n# Orchestrator\nTest.");
  writeJson(join(targetRoot, ".ai/agents/routing-policy.json"), {
    simple_task_indicators: [],
    specialists: [],
    temporary_agent: {
      proposal_id: "temp",
      default_role: "temporary",
      permissions: [],
      promotion_requires_human_approval: true
    }
  });
  writeJson(join(targetRoot, ".ai/skills/registry.json"), { skills: [] });
  writeJson(join(targetRoot, ".ai/policies/permissions.example.json"), { default: "deny", agents: {} });
  writeJson(join(targetRoot, ".ai/policies/provider-request-policy.example.json"), { default_strategy: "local-first" });
  writeJson(join(targetRoot, ".ai/policies/model-assignment.example.json"), { ownership: { assignment_owner: "user" } });
  writeJson(join(targetRoot, ".ai/harnesses/compatibility-matrix.json"), {
    version: "1",
    required_capabilities: [],
    harnesses: [{ id: "opencode", priority: "required", adapter_status: "executable-translation-spike", capabilities: {} }]
  });
}

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

  assert.match(developer.content, /Alfred source agent spec \(\.ai\/agents\/developer\.md\), quoted to avoid nested frontmatter parsing:/);
  assert.match(developer.content, /> Mission: implement scoped code changes under policy\./);
  assert.doesNotMatch(developer.content, /\n---\nid: developer\n/);

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

test("opencode runtime compaction hook avoids provider calls below threshold", async () => {
  const messages = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: "short message"
  }));
  const result = await runContextCompactionHook({ root, messages });
  assert.equal(result.compacted, false);
  assert.equal(result.provider_calls, 0);
  assert.equal(result.summary_messages.length, messages.length);
});

test("opencode runtime compaction hook emits trace above threshold and keeps provider_calls at 0", async () => {
  const messages = Array.from({ length: 200 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: "x".repeat(4000)
  }));
  const result = await runContextCompactionHook({ root, messages });
  assert.equal(result.compacted, true);
  assert.equal(result.provider_calls, 0);
  assert.ok(result.trace_events.includes("context_compaction_triggered"));
  assert.ok(result.trace_events.includes("provider_request_avoided"));
  assert.ok(result.summary_messages.length < messages.length);
});

test("buildOpencodeInstallPreview in worktree reads .ai/ source from project root", () => {
  const main = tmp("alfred-opencode-worktree-main-");
  const worktree = tmp("alfred-opencode-worktree-view-");
  try {
    git(["init"], main);
    buildAlfredTree(main);
    git(["add", "."], main);
    git(["commit", "-m", "init"], main);
    git(["worktree", "add", worktree], main);

    // Remove .ai/ from the worktree view so we can prove preview reads from project root.
    rmSync(join(worktree, ".ai"), { recursive: true, force: true });

    const preview = buildOpencodeInstallPreview({ root: worktree, outputDir: ".ai/generated/worktree-install" });

    assert.equal(preview.harness, "opencode");
    assert.equal(preview.files.filter((file) => file.kind === "agent").length, 1);
    assert.ok(preview.files.some((file) => file.install_path === ".opencode/agents/orchestrator.md"));
  } finally {
    rmSync(main, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
  }
});
