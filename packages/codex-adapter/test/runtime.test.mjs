import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, mkdtempSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCodexAdapterPreview,
  buildCodexAdapterReadiness,
  buildCodexInstallPreview,

  buildCodexIntegrationPreview,
  buildCodexStableRuntime,

  writeCodexInstallPreview
} from "../src/runtime.js";
import { applyCodexPrimaryInstructions, mergePrimaryInstructions, PRIMARY_BEGIN, PRIMARY_END } from "../src/primary-instructions.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));

test("codex preview emits project-scoped custom agent TOML artifacts", () => {
  const preview = buildCodexAdapterPreview({ root });
  assert.equal(preview.harness, "codex");
  assert.equal(preview.mvp_required, true);
  assert.equal(preview.preview_only, false);
  assert.equal(preview.generated_artifacts.agents.length, 5);
  assert.deepEqual(preview.generated_artifacts.primary_agent,
    { name: "orchestrator", path: "AGENTS.md", scope: "main-session" });
  assert.equal(preview.generated_artifacts.agents.some((agent) => agent.name === "orchestrator"), false);
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
  assert.match(developer.content, /Orchestrator instructions do not apply to delegated agents/);
  const primary = preview.files.find((file) => file.kind === "instructions");
  assert.equal(primary.install_path, "AGENTS.md");
  assert.equal(primary.merge_strategy, "alfred-codex-managed-block");
  assert.match(primary.content, /main Codex session acts as Alfred Orchestrator/);
  assert.match(primary.content, /Delegated subagents keep their assigned specialist roles/);
  assert.match(primary.content, /Mission: classify work/);
  assert.doesNotMatch(primary.content, /only when the parent Codex session/);
  assert.equal(preview.files.some((file) => file.install_path.endsWith("orchestrator.toml")), false);
});

test("codex install preview emits canonical repo skill artifacts with progressive disclosure", () => {
  const preview = buildCodexInstallPreview({ root, outputDir: ".ai/generated/test-codex-install" });
  const skills = preview.files.filter((file) => file.kind === "skill");
  assert.equal(skills.length, 5);
  assert.ok(skills.every((file) => file.install_path.startsWith(".agents/skills/")));
  assert.ok(preview.generated_artifacts.skills.every((skill) => skill.scope === "project"));
  assert.ok(preview.generated_artifacts.skills.every((skill) => skill.load_body_by_default === false));

  for (const skillId of ["typescript-project", "architecture-docs", "goal", "loop", "ulw"]) {
    const artifact = skills.find((file) => file.install_path === `.agents/skills/${skillId}/SKILL.md`);
    const canonical = readFileSync(join(root, `.ai/skills/project/${skillId}/SKILL.md`), "utf8")
      .trim()
      .replace(/^---\n[\s\S]*?\n---\n?/, "")
      .trim();
    assert.ok(artifact, `expected ${skillId} preview artifact`);
    assert.match(artifact.content, new RegExp(`^name: ${skillId}$`, "m"));
    assert.ok(artifact.content.endsWith(`${canonical}\n`), `${skillId} must preserve its canonical body`);
    assert.doesNotMatch(artifact.content, /Source body:/);
  }

  const goal = skills.find((file) => file.install_path === ".agents/skills/goal/SKILL.md");
  const loop = skills.find((file) => file.install_path === ".agents/skills/loop/SKILL.md");
  const ulw = skills.find((file) => file.install_path === ".agents/skills/ulw/SKILL.md");
  assert.match(goal.content, /approval state for every gated action/);
  assert.match(loop.content, /Never reset iteration or retry accounting/);
  assert.match(ulw.content, /ULW may be activated only by the primary Orchestrator/);
  assert.match(ulw.content, /effective role is any specialist or subagent, stop without executing ULW/);
  assert.match(ulw.content, /unsupported_runtime/);
  assert.match(ulw.content, /never enables bypass/);
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


test("codex stable runtime and integration preview expose required adapter contract", () => {
  const stable = buildCodexStableRuntime({ root });
  assert.equal(stable.status, "stable");
  assert.equal(stable.boundaries.harness_config_writes_disabled_by_default, true);
  assert.equal(stable.boundaries.model_assignment_user_owned, true);
  assert.equal(stable.provider_calls, 0);

  const preview = buildCodexIntegrationPreview({ root });
  assert.equal(preview.mvp_required, true);
  assert.equal(preview.preview_only, false);
  assert.equal(preview.generated_artifacts.stable_runtime_api, stable.runtime_api);
  assert.equal(preview.generated_artifacts.primary_agent.name, "orchestrator");
  assert.equal(preview.writes_harness_config_by_default, false);
  assert.equal(preview.human_approval_required_before_write, true);
});


test("Codex primary preview is isolated and approved installation preserves project instructions", () => {
  const outputDir = `.ai/generated/test-codex-install-${process.pid}`;
  const projectRoot = mkdtempSync(join(tmpdir(), "alfred-codex-primary-"));
  const agentsPath = join(projectRoot, "AGENTS.md");
  const userText = "# Project rules\n\nKeep user instructions exactly.\n";
  writeFileSync(agentsPath, userText);
  const repoInstructions = readFileSync(join(root, "AGENTS.md"), "utf8");
  try {
    const preview = writeCodexInstallPreview({ root, outputDir });
    const orchestrator = preview.files.find((file) => file.install_path === "AGENTS.md");
    assert.ok(orchestrator);
    const writtenPath = join(root, orchestrator.path);
    assert.ok(existsSync(writtenPath));
    assert.match(readFileSync(writtenPath, "utf8"), /# Orchestrator/);
    assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), repoInstructions);
    const options = { previewRoot: join(root, outputDir), projectRoot };
    assert.throws(() => applyCodexPrimaryInstructions(options), /Human approval required/);
    assert.equal(readFileSync(agentsPath, "utf8"), userText);
    const result = applyCodexPrimaryInstructions({ ...options, approval: true });
    assert.equal(result.target_path, agentsPath);
    assert.equal(result.provider_calls, 0);
    const installed = readFileSync(agentsPath, "utf8");
    assert.ok(installed.startsWith(userText));
    assert.equal(applyCodexPrimaryInstructions({ ...options, approval: true }).changed, false);
    assert.equal(readFileSync(agentsPath, "utf8"), installed);
    const oldBlock = `${PRIMARY_BEGIN}\nOld instructions\n${PRIMARY_END}`;
    assert.equal(mergePrimaryInstructions("before\n" + oldBlock + "\nafter", orchestrator.content),
      "before\n" + orchestrator.content.trimEnd() + "\nafter");
    for (const malformed of [PRIMARY_BEGIN, PRIMARY_END, oldBlock + oldBlock]) {
      writeFileSync(agentsPath, malformed);
      assert.throws(() => applyCodexPrimaryInstructions({ ...options, approval: true }), /Malformed/);
      assert.equal(readFileSync(agentsPath, "utf8"), malformed);
    }
    writeFileSync(agentsPath, installed);
    const overridePath = join(projectRoot, "AGENTS.override.md");
    writeFileSync(overridePath, "# Active override\n");
    assert.equal(applyCodexPrimaryInstructions({ ...options, approval: true }).target_path, overridePath);
    assert.ok(readFileSync(overridePath, "utf8").startsWith("# Active override\n"));
    assert.equal(readFileSync(agentsPath, "utf8"), installed);
    writeFileSync(overridePath, "");
    assert.equal(applyCodexPrimaryInstructions({ ...options, approval: true }).target_path, agentsPath);
    rmSync(overridePath);
    symlinkSync(agentsPath, overridePath);
    assert.throws(() => applyCodexPrimaryInstructions({ ...options, approval: true }), /not a symlink/);
    assert.equal(readFileSync(agentsPath, "utf8"), installed);
    rmSync(overridePath);
    rmSync(agentsPath);
    applyCodexPrimaryInstructions({ ...options, approval: true });
    assert.equal(readFileSync(agentsPath, "utf8"), orchestrator.content);
  } finally {
    rmSync(join(root, outputDir), { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
