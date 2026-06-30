import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCodexAdapterPreview,
  buildCodexAdapterReadiness,
  buildCodexInstallPreview,
  writeCodexInstallPreview
} from "../src/runtime.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));

test("codex preview emits project-scoped custom agent TOML artifacts", () => {
  const preview = buildCodexAdapterPreview({ root });
  assert.equal(preview.harness, "codex");
  assert.equal(preview.mvp_required, true);
  assert.equal(preview.preview_only, false);
  assert.equal(preview.generated_artifacts.agents.length, 6);
  for (const agent of preview.generated_artifacts.agents) {
    assert.match(agent.path, /^\.codex\/agents\/[a-z-]+\.toml$/);
    assert.ok(agent.name);
    assert.ok(agent.description);
  }
});

test("codex install preview writes valid custom agent fields without hard-coded model", () => {
  const preview = buildCodexInstallPreview({ root, outputDir: ".ai/generated/test-codex-install" });
  const developer = preview.files.find((file) => file.install_path === ".codex/agents/developer.toml");
  assert.ok(developer);
  assert.match(developer.content, /^name = "developer"$/m);
  assert.match(developer.content, /^description = /m);
  assert.match(developer.content, /^developer_instructions = /m);
  assert.match(developer.content, /Mission: implement scoped code changes under policy\./);
  assert.doesNotMatch(developer.content, /^model\s*=/m);
  assert.doesNotMatch(developer.content, /^model_reasoning_effort\s*=/m);
});

test("codex install preview emits repo skill artifacts with progressive disclosure", () => {
  const preview = buildCodexInstallPreview({ root, outputDir: ".ai/generated/test-codex-install" });
  const skills = preview.files.filter((file) => file.kind === "skill");
  assert.equal(skills.length, 2);
  assert.ok(skills.every((file) => file.install_path.startsWith(".agents/skills/")));
  const typescript = skills.find((file) => file.install_path === ".agents/skills/typescript-project/SKILL.md");
  assert.ok(typescript);
  assert.match(typescript.content, /^name: typescript-project$/m);
  assert.match(typescript.content, /Preserve progressive disclosure/);
  assert.match(typescript.content, /Source body: \.ai\/skills\/project\/typescript-project\/SKILL\.md/);
});

test("codex readiness proves Alfred invariants without provider calls", () => {
  const readiness = buildCodexAdapterReadiness({ root });
  assert.equal(readiness.status, "hardened");
  assert.equal(readiness.invariants.core_is_harness_agnostic, true);
  assert.equal(readiness.invariants.model_assignment_user_owned, true);
  assert.equal(readiness.invariants.skill_bodies_lazy_loaded, true);
  assert.equal(readiness.invariants.permissions_deny_by_default, true);
  assert.equal(readiness.provider_calls, 0);
});

test("writeCodexInstallPreview writes only preview files under requested output dir", () => {
  const outputDir = `.ai/generated/test-codex-install-${process.pid}`;
  try {
    const preview = writeCodexInstallPreview({ root, outputDir });
    const orchestrator = preview.files.find((file) => file.install_path === ".codex/agents/orchestrator.toml");
    assert.ok(orchestrator);
    const writtenPath = join(root, orchestrator.path);
    assert.ok(existsSync(writtenPath));
    assert.match(readFileSync(writtenPath, "utf8"), /# Orchestrator/);
  } finally {
    rmSync(join(root, outputDir), { recursive: true, force: true });
  }
});
