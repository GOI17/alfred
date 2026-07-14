#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { discoverInstallEnvironment, DISCOVERY_SCHEMA } from "./install-discovery.mjs";

const home = "/fixture/home";
const cwd = "/fixture/worktree";
const existing = new Set([
  "/tmp/ollama.sock",
  path.join(home, ".alfred", "models.json"),
  path.join(home, ".alfred", "installs", "team")
]);
const gitCommands = {
  "rev-parse --show-toplevel": cwd,
  "rev-parse --git-dir": "/fixture/repo/.git/worktrees/team",
  "rev-parse --git-common-dir": "/fixture/repo/.git"
};
const secret = "super-secret-provider-value";
const report = discoverInstallEnvironment({
  env: {
    PATH: "/fixture/bin",
    OPENAI_API_KEY: secret,
    ANTHROPIC_API_KEY: "another-secret",
    OLLAMA_HOST: "http://secret-host:11434"
  },
  homeDir: home,
  cwd,
  targetPath: path.join(home, ".alfred", "installs", "team"),
  platform: "linux",
  release: "6.10-fixture",
  architecture: "arm64",
  nodeVersion: "v24.2.0",
  commandExists: (name) => ["git", "opencode", "codex"].includes(name),
  fileExists: (candidate) => existing.has(candidate),
  directoryExists: (candidate) => existing.has(candidate),
  runGit: (args) => gitCommands[args.join(" ")] ?? null
});

assert.equal(report.schema, DISCOVERY_SCHEMA);
assert.deepEqual(report.os, { platform: "linux", release: "6.10-fixture", architecture: "arm64" });
assert.deepEqual(report.node, { status: "ok", version: "v24.2.0", major: 24, required_major: 22 });
assert.equal(report.harnesses.opencode, "installed");
assert.equal(report.harnesses["codex-cli"], "installed");
assert.equal(report.install.target_exists, true);
assert.equal(report.install.models_config_exists, true);
assert.equal(report.git.repository_state, "repository");
assert.equal(report.git.linked_worktree_state, "linked-worktree");
assert.equal(report.git.workspace_root, cwd);
assert.equal(report.git.project_root, "/fixture/repo");
assert.equal(report.provider_calls, 0);
assert.deepEqual(report.models.suggestions.map((item) => item.source), [
  "env:OLLAMA_HOST",
  "env:OPENAI_API_KEY",
  "env:ANTHROPIC_API_KEY"
]);
assert.equal(report.models.validation.status, "pass");
assert.equal(report.models.proposed_config["*"].primary, "ollama/qwen2.5-coder:7b");
assert.equal(report.models.proposed_config.orchestrator.primary, "anthropic/claude-sonnet-4");
assert.equal(report.models.proposed_config.developer.primary, "anthropic/claude-sonnet-4");
assert.deepEqual(report.models.proposed_config.fallbacks, [
  "ollama/qwen2.5-coder:7b",
  "openai/gpt-4.1-mini",
  "anthropic/claude-sonnet-4"
]);
const serialized = JSON.stringify(report);
assert.doesNotMatch(serialized, new RegExp(secret));
assert.doesNotMatch(serialized, /another-secret|secret-host/);

const oldNode = discoverInstallEnvironment({
  env: {}, homeDir: home, cwd, nodeVersion: "v20.9.0",
  platform: "darwin", release: "fixture", architecture: "x64",
  commandExists: () => false, fileExists: () => false, directoryExists: () => false
});
assert.equal(oldNode.node.status, "too-old");
assert.equal(oldNode.git.availability, "not-installed");
assert.equal(oldNode.git.linked_worktree_state, "not-applicable");
assert.deepEqual(oldNode.models.suggestions, []);
assert.deepEqual(oldNode.models.proposed_config, { fallbacks: [] });
assert.equal(oldNode.provider_calls, 0);

let shellAuthorityGitCalls = 0;
const shellAuthority = discoverInstallEnvironment({
  env: {
    ALFRED_INSTALL_SOURCE_WORKSPACE_PATH: "/fixture/source/subdir",
    ALFRED_INSTALL_WORKSPACE_ROOT: "/fixture/source",
    ALFRED_INSTALL_PROJECT_ROOT: "/fixture/canonical",
    ALFRED_INSTALL_GIT_AVAILABILITY: "installed",
    ALFRED_INSTALL_GIT_REPOSITORY_STATE: "repository",
    ALFRED_INSTALL_GIT_WORKTREE_STATE: "linked-worktree"
  },
  homeDir: home,
  cwd,
  commandExists: () => true,
  fileExists: () => false,
  directoryExists: () => false,
  runGit: () => { shellAuthorityGitCalls += 1; return "/wrong"; }
});
assert.equal(shellAuthorityGitCalls, 0, "discovery consumes shell-resolved git identity without rerunning git");
assert.equal(shellAuthority.git.source_workspace_path, "/fixture/source/subdir");
assert.equal(shellAuthority.git.workspace_root, "/fixture/source");
assert.equal(shellAuthority.git.project_root, "/fixture/canonical");
assert.equal(shellAuthority.git.linked_worktree_state, "linked-worktree");

console.log("install discovery tests ok");
