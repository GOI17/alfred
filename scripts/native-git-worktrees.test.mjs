import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (relative) => readFileSync(join(root, relative), "utf8");
const canonical = read(".ai/agents/orchestrator.md").trim();
const body = canonical.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
const policy = body.split("## Repository write isolation")[1].split("\nRules:")[0];
const normalizedPolicy = policy.replace(/\s+/g, " ");

// Instruction contracts: these checks verify what agents receive, not runtime
// enforcement of Git commands by an LLM or a new worktree execution service.
test("canonical policy gates every repository write and exempts read-only work", () => {
  for (const requirement of [
    "Read-only tasks do not require a worktree",
    "code, docs, configuration, specs, generated artifacts, trace files and deletions",
    "before writing the SDD spec or delegating a write",
    "git worktree add -b <task-branch> <task-path> <base>",
    "A branch alone or an unrelated worktree is insufficient",
    "already created for this task MUST be verified and reused",
    "do not recursively create a worktree per write or delegation",
    "Independent writing tasks require separate worktrees"
  ]) assert.ok(normalizedPolicy.includes(requirement), requirement);
});

test("canonical policy preserves dirty checkouts and fails closed before writes", () => {
  for (const requirement of [
    "Honor the user-requested base",
    "resolve the repository's default base through Git",
    "Do not assume the current branch or hardcode main/master",
    "If the base is unresolved, stop and report it",
    "never overwrite a collision",
    "Do not reset, clean, stash, switch branches or copy uncommitted changes",
    "failed verification blocks repository writes",
    "without falling back to the main checkout",
    "native Git for the entire worktree lifecycle",
    "Never use clones, directory copies, harness APIs or Orca",
    "use a non-repository trace channel",
    "grants no additional protected-path permissions"
  ]) assert.ok(normalizedPolicy.includes(requirement), requirement);
});

test("canonical policy verifies task context before delegating and records decisions", () => {
  for (const requirement of [
    "git rev-parse --show-toplevel",
    "git rev-parse --git-common-dir",
    "git branch --show-current",
    "git worktree list --porcelain",
    "git status --short",
    "Pass the verified cwd, branch, base and task identity to every delegated agent",
    "agents reuse that worktree and retain their assigned specialist roles",
    "Emit traces for classification, permission checks, creation/reuse, verification, failures and delegation"
  ]) assert.ok(normalizedPolicy.includes(requirement), requirement);
});

test("entry and SDD instructions establish isolation before creating a spec", () => {
  for (const file of ["AGENTS.md", ".ai/development.md"]) {
    const content = read(file);
    assert.ok(content.indexOf("git worktree add -b") < content.indexOf("Create spec file") ||
      (file === "AGENTS.md" && content.indexOf("git worktree add -b") < content.indexOf("3. Read existing specs")));
    assert.match(content, /Read-only tasks (?:need no|do not require a) worktree/);
    assert.match(content, /\.ai\/agents\/orchestrator\.md/);
  }
});

let previewsPromise;
function previews() {
  previewsPromise ??= Promise.all([
    import("../packages/pi-adapter/src/runtime.js"),
    import("../packages/codex-adapter/src/runtime.js"),
    import("../packages/opencode-adapter/src/runtime.js")
  ]).then(([pi, codex, opencode]) => ({
    pi: pi.buildPiInstallPreview({ root }),
    codex: codex.buildCodexInstallPreview({ root }),
    opencode: opencode.buildOpencodeInstallPreview({ root })
  }));
  return previewsPromise;
}
const primary = (preview, installPath) => {
  const file = preview.files.find((candidate) => candidate.install_path === installPath);
  assert.ok(file, `missing primary surface ${installPath}`);
  return file;
};

test("all executable primary surfaces carry the complete canonical policy", async () => {
  const { pi, codex, opencode } = await previews();
  const primaryFiles = [
    primary(pi, "./AGENTS.md"),
    primary(pi, "./.alfred/agents/orchestrator.md"),
    primary(codex, "AGENTS.md"),
    primary(opencode, ".opencode/agents/orchestrator.md")
  ];
  for (const file of primaryFiles) {
    const unquoted = file.content.replace(/^> ?/gm, "");
    assert.ok(unquoted.includes(body), `${file.path} must preserve the canonical Orchestrator body`);
  }
  const opencodePrimary = primary(opencode, ".opencode/agents/orchestrator.md").content;
  const isolation = opencodePrimary.indexOf("Before delegating a repository-writing task");
  assert.ok(isolation >= 0 && isolation < opencodePrimary.indexOf("STOP-and-delegate rule"));
  for (const preview of [pi, codex, opencode]) assert.equal(preview.provider_calls, 0);
  assert.doesNotMatch(primary(pi, "./AGENTS.md").content, /minimax|ollama-cloud/);
});

test("specialists never inherit the primary worktree creation or routing role", async () => {
  const { pi, codex, opencode } = await previews();
  for (const preview of [pi, codex, opencode]) {
    const specialists = preview.files.filter((candidate) => candidate.kind === "agent" &&
      !candidate.install_path.endsWith("/orchestrator.md"));
    assert.equal(specialists.length, 5);
    for (const file of specialists) {
      assert.doesNotMatch(file.content, /## Repository write isolation|if you are about to write, edit, refactor, or delete application code, stop and delegate/);
      assert.match(file.content, /specialist role|Specialist role boundary/);
    }
  }
  for (const preview of [pi, codex]) {
    const instructions = preview.files.find((file) => file.install_path.endsWith("AGENTS.md"));
    assert.match(instructions.content, /Delegated subagents keep their assigned specialist roles/);
  }
});

test("tracked primary previews match their generators and omit obsolete Codex primary agent", async () => {
  const { codex, opencode } = await previews();
  for (const file of [primary(codex, "AGENTS.md"), primary(opencode, ".opencode/agents/orchestrator.md")]) {
    assert.equal(read(file.path), file.content, `${file.path} must be regenerated from source`);
  }
  assert.equal(existsSync(join(root, ".ai/generated/codex-install/.codex/agents/orchestrator.toml")), false);
});
