import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { execFileSync } from "node:child_process";

import {
  buildOpencodeAdapterPreview,
  buildOpencodeInstallPreview,
  buildOpencodeJsonPreview,
  writeOpencodeInstallPreview,
  runContextCompactionHook
} from "../src/runtime.js";
import { loadArchitectureKernel } from "../../core/src/index.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const specialistRoleScopes = {
  developer: "Developer implements authorized changes.",
  architect: "Architect handles architecture, DDD, and pattern decisions.",
  qa: "QA handles testing, regression coverage design, and bug verification.",
  reviewer: "Reviewer handles code review and policy enforcement.",
  librarian: "Librarian searches, reads, summarizes, and indexes knowledge without writing files."
};

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

function frontmatter(content) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
  assert.ok(match, "expected YAML frontmatter");
  return match[1];
}

function agentFile(preview, agentId) {
  const file = preview.files.find((candidate) => candidate.install_path === `.opencode/agents/${agentId}.md`);
  assert.ok(file, `expected generated agent file for ${agentId}`);
  return file;
}

test("opencode preview emits current plural agent paths", () => {
  const preview = buildOpencodeAdapterPreview({ kernel: loadKernel() });
  assert.equal(preview.harness, "opencode");
  assert.equal(preview.generated_artifacts.agents.length, 6);
  for (const agent of preview.generated_artifacts.agents) {
    assert.match(agent.path, /^\.opencode\/agents\/[a-z-]+\.md$/);
    assert.doesNotMatch(agent.path, /^\.opencode\/agent\//);
    assert.equal(agent.model, undefined);
  }
});

test("opencode install preview maps files to installable opencode agent artifacts", () => {
  const preview = buildOpencodeInstallPreview({ root, outputDir: ".ai/generated/test-opencode-install" });
  const agents = preview.files.filter((file) => file.kind === "agent");
  assert.equal(agents.length, 6);
  assert.ok(agents.every((file) => file.install_path.startsWith(".opencode/agents/")));
  assert.ok(agents.every((file) => !/^model:/m.test(frontmatter(file.content))));
  assert.equal(preview.provider_calls, 0);
  const developer = agents.find((file) => file.install_path === ".opencode/agents/developer.md");
  assert.ok(developer);
  assert.match(developer.content, /Mission: implement scoped code changes under policy\./);
  assert.doesNotMatch(developer.content, /anthropic\/claude|openai\/gpt|ollama\//);

  assert.match(developer.content, /Alfred source agent spec \(\.ai\/agents\/developer\.md\), quoted to avoid nested frontmatter parsing:/);
  assert.match(developer.content, /> Mission: implement scoped code changes under policy\./);
  assert.doesNotMatch(developer.content, /\n---\nid: developer\n/);

  const agentSpecs = readdirSync(join(root, ".ai/agents")).filter((file) => file.endsWith(".md"));
  assert.ok(agentSpecs.length > 0);
  for (const file of agentSpecs) {
    const content = readFileSync(join(root, ".ai/agents", file), "utf8");
    assert.doesNotMatch(content, /^model\s*:/m, `${file} must not hardcode a model`);
  }
});

test("opencode generation keeps Orchestrator routing out of every specialist", () => {
  const preview = buildOpencodeInstallPreview({ root, outputDir: ".ai/generated/test-opencode-install" });
  const orchestrator = agentFile(preview, "orchestrator");
  const stopDirective = /if you are about to write, edit, refactor, or delete application code, stop and delegate to the `developer` agent/;

  assert.match(orchestrator.content, /## Routing table \(execute before any action\)/);
  assert.match(orchestrator.content, stopDirective);
  assert.match(orchestrator.content, /Route implementation\/coding work to the `developer` agent/);

  for (const [agentId, roleScope] of Object.entries(specialistRoleScopes)) {
    const specialist = agentFile(preview, agentId);
    const sourceSpec = readFileSync(join(root, `.ai/agents/${agentId}.md`), "utf8").trim();
    const quotedSource = sourceSpec.split("\n").map((line) => line ? `> ${line}` : ">").join("\n");

    assert.match(frontmatter(specialist.content), /^mode: subagent$/m);
    assert.match(frontmatter(specialist.content), /^permission:\n  edit: ask\n  bash: ask$/m);
    assert.match(specialist.content, /## Specialist role boundary/);
    assert.ok(specialist.content.includes(roleScope));
    assert.match(specialist.content, /There is no self-delegation or nested Task availability requirement/);
    assert.doesNotMatch(specialist.content, stopDirective);
    assert.doesNotMatch(specialist.content, /Route implementation\/coding work to the `developer` agent/);
    assert.ok(specialist.content.includes(quotedSource), `${agentId} must preserve its quoted canonical specification`);
    assert.match(specialist.content, /Preserve Alfred's local-first provider policy/);
    assert.match(specialist.content, /Do not broaden permissions/);
    assert.match(specialist.content, /Honor protected paths and all higher-priority security and approval requirements/);
    assert.match(specialist.content, /Keep model assignment user-owned at runtime/);
  }

  const librarian = agentFile(preview, "librarian");
  assert.match(librarian.content, /> - Read-only by default\./);
  assert.match(librarian.content, /> - Do not edit files\./);
});

test("opencode preview delivers all canonical project skill bodies lazily", () => {
  const preview = buildOpencodeInstallPreview({ root, outputDir: ".ai/generated/test-opencode-install" });
  const skills = preview.files.filter((file) => file.kind === "skill");

  assert.equal(skills.length, 6);
  assert.ok(preview.generated_artifacts.skills.every((skill) => skill.scope === "project"));
  assert.ok(preview.generated_artifacts.skills.every((skill) => skill.load_body_by_default === false));

  for (const skillId of ["typescript-project", "architecture-docs", "goal", "loop", "ulw", "alfred"]) {
    const artifact = skills.find((file) => file.install_path === `.opencode/skills/${skillId}/SKILL.md`);
    const canonical = readFileSync(join(root, `.ai/skills/project/${skillId}/SKILL.md`), "utf8")
      .trim()
      .replace(/^---\n[\s\S]*?\n---\n?/, "")
      .trim();
    assert.ok(artifact, `expected ${skillId} preview artifact`);
    assert.match(artifact.content, new RegExp(`^name: ${skillId}$`, "m"));
    assert.ok(artifact.content.endsWith(`${canonical}\n`), `${skillId} must preserve its canonical body`);
    assert.doesNotMatch(artifact.content, /Source body:/);
  }

  assert.match(skills.find((file) => file.install_path.includes("/goal/")).content, /observable acceptance criteria/);
  assert.match(skills.find((file) => file.install_path.includes("/loop/")).content, /no-progress exhaustion/);
  const ulw = skills.find((file) => file.install_path.includes("/ulw/"));
  assert.match(ulw.content, /ULW may be activated only by the primary Orchestrator/);
  assert.match(ulw.content, /effective role is any specialist or subagent, stop without executing ULW/);
  assert.match(ulw.content, /authoritative current-session/);
});

test("project skill registry preserves existing contracts and keeps GOAL, LOOP, and ULW constrained", () => {
  const registry = JSON.parse(readFileSync(join(root, ".ai/skills/registry.json"), "utf8"));
  const expectedExistingEntries = {
    "typescript-project": {
      id: "typescript-project",
      name: "typescript-project",
      description: "Use only when TypeScript project files, package scripts, or ts/js source changes require TypeScript-specific guidance.",
      triggers: ["typescript", "tsconfig", "package.json", ".ts", ".tsx"],
      projectSignals: ["package.json", "tsconfig.json", "pnpm-workspace.yaml"],
      source: "project",
      scope: "project",
      bodyPath: ".ai/skills/project/typescript-project/SKILL.md",
      allowedAgents: ["orchestrator", "developer", "qa", "reviewer"],
      loadsBodyByDefault: false
    },
    "architecture-docs": {
      id: "architecture-docs",
      name: "architecture-docs",
      description: "Use only when architecture documents, DDD language, phase handoffs, or model-readable project policy files are edited.",
      triggers: ["architecture", "ddd", "phase", "policy", "manifest", ".ai/"],
      projectSignals: ["AGENTS.md", "docs/architecture", ".ai/manifest.json"],
      source: "project",
      scope: "project",
      bodyPath: ".ai/skills/project/architecture-docs/SKILL.md",
      allowedAgents: ["orchestrator", "architect", "librarian", "reviewer"],
      loadsBodyByDefault: false
    }
  };
  const expectedBodyPaths = {
    goal: ".ai/skills/project/goal/SKILL.md",
    loop: ".ai/skills/project/loop/SKILL.md",
    ulw: ".ai/skills/project/ulw/SKILL.md"
  };

  for (const [existingId, expectedEntry] of Object.entries(expectedExistingEntries)) {
    const matches = registry.skills.filter((skill) => skill.id === existingId);
    assert.equal(matches.length, 1, `existing registry entry ${existingId} must be preserved exactly once`);
    assert.deepEqual(matches[0], expectedEntry, `existing registry entry ${existingId} must preserve its complete contract`);
  }

  for (const [skillId, bodyPath] of Object.entries(expectedBodyPaths)) {
    const matches = registry.skills.filter((skill) => skill.id === skillId);
    assert.equal(matches.length, 1, `${skillId} must have exactly one registry entry`);
    assert.equal(matches[0].scope, "project");
    assert.equal(matches[0].loadsBodyByDefault, false);
    assert.equal(matches[0].bodyPath, bodyPath);
  }

  const ulw = registry.skills.find((skill) => skill.id === "ulw");
  assert.deepEqual(ulw.allowedAgents, ["orchestrator"]);
});

test("opencode config preview omits custom and parallel agent model bindings", () => {
  const config = buildOpencodeJsonPreview({
    modelAssignments: [
      {
        agent_id: "developer",
        primary: "anthropic/claude-sonnet-4",
        fallbacks: ["openai/gpt-4.1-mini"],
        provider_calls: 0
      }
    ]
  });

  assert.equal(Object.hasOwn(config, "model_assignment"), false);
  assert.equal(Object.hasOwn(config, "agent"), false);
  assert.doesNotMatch(JSON.stringify(config), /user-owned-runtime-configuration|openai\/gpt-4\.1-mini/);
});

test("opencode install preview emits normalized assignments only in matching agent frontmatter", () => {
  const primary = 'acme/model: "quoted" \\ preview';
  const fallback = "openai/fallback-must-not-be-native";
  const unknownPrimary = "acme/unknown-agent-model";
  const preview = buildOpencodeInstallPreview({
    root,
    outputDir: ".ai/generated/test-opencode-install",
    modelAssignments: [
      { agent_id: "developer", primary, fallbacks: [fallback] },
      { agent_id: "not-an-alfred-agent", primary: unknownPrimary }
    ]
  });
  const config = JSON.parse(preview.files.find((file) => file.install_path === "opencode.json").content);
  const developer = agentFile(preview, "developer");
  const nativeArtifactContent = preview.files.map((file) => file.content).join("\n");

  assert.match(frontmatter(developer.content), new RegExp(`^model: ${JSON.stringify(primary).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  for (const file of preview.files.filter((candidate) => candidate.kind === "agent" && candidate !== developer)) {
    assert.doesNotMatch(frontmatter(file.content), /^model:/m);
  }
  assert.equal(Object.hasOwn(config, "model_assignment"), false);
  assert.equal(Object.hasOwn(config, "agent"), false);
  assert.doesNotMatch(nativeArtifactContent, new RegExp(fallback));
  assert.doesNotMatch(nativeArtifactContent, new RegExp(unknownPrimary));
  assert.doesNotMatch(JSON.stringify(preview), /user-owned-runtime-configuration/);
  assert.equal(preview.provider_calls, 0);

  const objectFallback = "anthropic/fallback-must-not-be-native";
  const objectPreview = buildOpencodeInstallPreview({
    root,
    outputDir: ".ai/generated/test-opencode-install",
    modelAssignments: {
      developer: { primary: "  anthropic/claude-sonnet-4  ", fallbacks: [objectFallback] },
      qa: { primary: "   ", fallbacks: [objectFallback] },
      reviewer: { primary: "", fallbacks: [] }
    }
  });

  assert.match(frontmatter(agentFile(objectPreview, "developer").content), /^model: "anthropic\/claude-sonnet-4"$/m);
  assert.doesNotMatch(frontmatter(agentFile(objectPreview, "qa").content), /^model:/m);
  assert.doesNotMatch(frontmatter(agentFile(objectPreview, "reviewer").content), /^model:/m);
  assert.doesNotMatch(objectPreview.files.map((file) => file.content).join("\n"), new RegExp(objectFallback));
  assert.equal(objectPreview.provider_calls, 0);
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
  const outputDir = `.ai/generated/test-opencode-install-model-${process.pid}`;
  const primary = "anthropic/claude-sonnet-4";
  const fallback = "openai/fallback-must-not-be-native";
  try {
    const preview = writeOpencodeInstallPreview({
      root,
      outputDir,
      modelAssignments: [{ agent_id: "developer", primary, fallbacks: [fallback] }]
    });
    const orchestrator = preview.files.find((file) => file.install_path === ".opencode/agents/orchestrator.md");
    assert.ok(orchestrator);
    const writtenPath = join(root, orchestrator.path);
    assert.ok(existsSync(writtenPath));
    assert.match(readFileSync(writtenPath, "utf8"), /# Orchestrator/);
    const developer = agentFile(preview, "developer");
    const writtenDeveloper = readFileSync(join(root, developer.path), "utf8");
    const configFile = preview.files.find((file) => file.install_path === "opencode.json");
    assert.ok(configFile);
    const writtenConfig = JSON.parse(readFileSync(join(root, configFile.path), "utf8"));
    const writtenContent = preview.files.map((file) => readFileSync(join(root, file.path), "utf8")).join("\n");

    assert.match(frontmatter(writtenDeveloper), /^model: "anthropic\/claude-sonnet-4"$/m);
    assert.doesNotMatch(writtenContent, new RegExp(fallback));
    assert.doesNotMatch(writtenContent, /user-owned-runtime-configuration/);
    assert.equal(Object.hasOwn(writtenConfig, "model_assignment"), false);
    assert.equal(Object.hasOwn(writtenConfig, "agent"), false);
    assert.equal(writtenConfig.permission.edit, "ask");
    assert.equal(writtenConfig.permission.bash["rm *"], "deny");
    assert.equal(preview.provider_calls, 0);
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

test("opencode worktree previews prefer local source and preserve the shared fallback", () => {
  const main = tmp("alfred-opencode-worktree-main-");
  const worktree = tmp("alfred-opencode-worktree-view-");
  try {
    git(["init"], main);
    buildAlfredTree(main);
    git(["add", "."], main);
    git(["commit", "-m", "init"], main);
    git(["worktree", "add", worktree], main);

    const specPath = ".ai/agents/orchestrator.md";
    const mainSpec = "# Orchestrator\nDirty main instructions must stay untouched.\n";
    const worktreeSpec = "# Orchestrator\nTask worktree instructions must win.\n";
    writeFileSync(join(main, specPath), mainSpec);
    writeFileSync(join(worktree, specPath), worktreeSpec);
    const mainStatus = git(["status", "--porcelain"], main);
    const options = { root: worktree, outputDir: ".ai/generated/worktree-install" };
    const localPreview = buildOpencodeInstallPreview(options);
    assert.match(agentFile(localPreview, "orchestrator").content, /Task worktree instructions must win/);
    assert.doesNotMatch(agentFile(localPreview, "orchestrator").content, /Dirty main instructions/);
    const written = writeOpencodeInstallPreview(options);
    const primary = agentFile(written, "orchestrator");
    assert.equal(readFileSync(join(worktree, primary.path), "utf8"), primary.content);
    assert.match(primary.content, /Task worktree instructions must win/);
    assert.equal(existsSync(join(main, options.outputDir)), false);
    const overridden = buildOpencodeInstallPreview({ ...options, projectRoot: main });
    assert.match(agentFile(overridden, "orchestrator").content, /Dirty main instructions/);
    assert.equal(readFileSync(join(main, specPath), "utf8"), mainSpec);
    assert.equal(git(["status", "--porcelain"], main), mainStatus);

    // Remove .ai/ from the worktree view so we can prove preview reads from project root.
    rmSync(join(worktree, ".ai"), { recursive: true, force: true });

    const preview = buildOpencodeInstallPreview({ root: worktree, outputDir: ".ai/generated/worktree-install" });

    assert.equal(preview.harness, "opencode");
    assert.match(agentFile(preview, "orchestrator").content, /Dirty main instructions/);
    assert.equal(git(["status", "--porcelain"], main), mainStatus);
    assert.equal(preview.files.filter((file) => file.kind === "agent").length, 1);
    assert.ok(preview.files.some((file) => file.install_path === ".opencode/agents/orchestrator.md"));
  } finally {
    rmSync(main, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
  }
});
