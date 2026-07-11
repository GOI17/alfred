import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
  activateProfile,
  buildProfileActivationPlan,
  buildProfileManagerComponent,
  detectMachineCapabilities,
  detectMachineModels,
  initProfileRepository,
  materializeLocalProfile,
  scanSecretCandidates
} from "../src/index.js";

function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "alfred-profile-manager-"));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

test("init creates canonical shared/local profile repository layout", () => {
  fixture((root) => {
    const repo = join(root, "profiles-repo");
    const result = initProfileRepository({ repoPath: repo });
    assert.equal(result.status, "pass");
    assert.ok(existsSync(join(repo, "profiles")));
    assert.ok(existsSync(join(repo, "profiles.local")));
    assert.match(readFileSync(join(repo, ".gitignore"), "utf8"), /profiles\.local\//);
    assert.equal(result.provider_calls, 0);
  });
});

test("materializeLocalProfile merges tracked opencode defaults with machine-local overlay", () => {
  fixture((root) => {
    const repo = join(root, "repo");
    initProfileRepository({ repoPath: repo });
    write(
      join(repo, "profiles", "work", "opencode", "opencode.jsonc"),
      `{
        // shared default
        "provider": { "anthropic": { "enabled": false }, "ollama": { "enabled": true } },
        "plugin": ["shared"],
        "mcp": { "demo": { "headers": { "Authorization": "Bearer ${"${DEMO_TOKEN}"}" } } }
      }`
    );
    write(
      join(repo, "profiles.local", "work", "opencode", "opencode.jsonc"),
      `{
        "provider": { "anthropic": { "enabled": true } },
        "plugin": ["machine-local"]
      }`
    );

    const result = materializeLocalProfile({ repoPath: repo, profile: "work", agent: "opencode" });
    assert.equal(result.status, "pass");
    const merged = JSON.parse(readFileSync(join(repo, "profiles.local", "work", "opencode", "opencode.jsonc"), "utf8"));
    assert.equal(merged.provider.ollama.enabled, true);
    assert.equal(merged.provider.anthropic.enabled, true);
    assert.deepEqual(merged.plugin, ["machine-local"]);
  });
});

test("secret scan blocks literal secrets in tracked JSON but allows placeholders", () => {
  fixture((root) => {
    const safe = join(root, "safe");
    const unsafe = join(root, "unsafe");
    write(join(safe, "opencode.jsonc"), `{ "headers": { "Authorization": "Bearer ${"${DEMO_TOKEN}"}" } }`);
    write(join(unsafe, "opencode.jsonc"), `{ "headers": { "Authorization": "Bearer sk-1234567890abcdef123456" } }`);

    assert.equal(scanSecretCandidates({ sourceDir: safe }).status, "pass");
    const scan = scanSecretCandidates({ sourceDir: unsafe });
    assert.equal(scan.status, "fail");
    assert.deepEqual(scan.findings.map((finding) => finding.pointer), ["headers/Authorization"]);
  });
});

test("activation plan and switch keep harness writes approval-gated", () => {
  fixture((root) => {
    const repo = join(root, "repo");
    const home = join(root, "home");
    initProfileRepository({ repoPath: repo });
    write(join(repo, "profiles", "personal", "opencode", "opencode.jsonc"), `{ "plugin": ["shared"] }`);

    const plan = buildProfileActivationPlan({ repoPath: repo, profile: "personal", agent: "opencode", homeDir: home });
    assert.equal(plan.status, "pass");
    assert.equal(plan.writes_harness_config_by_default, false);
    assert.equal(plan.provider_calls, 0);

    const dryRun = activateProfile({ repoPath: repo, profile: "personal", agent: "opencode", homeDir: home, dryRun: true });
    assert.equal(dryRun.applied, false);
    assert.equal(existsSync(join(home, ".config", "opencode")), false);

    const applied = activateProfile({ repoPath: repo, profile: "personal", agent: "opencode", homeDir: home });
    assert.equal(applied.applied, true);
    assert.ok(lstatSync(join(home, ".config", "opencode")).isSymbolicLink());
    assert.equal(readFileSync(join(repo, ".alfred", "observability", "profile-manager-trace.json"), "utf8").includes("profile_manager_operation"), true);
  });
});

test("machine capability report explains missing PATH/provider/model/plugin inputs locally", () => {
  fixture((root) => {
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "opencode"), "#!/bin/sh\n");
    const report = detectMachineCapabilities({
      pathEnv: bin,
      providers: { ollama: true },
      models: { "qwen-local": true },
      plugins: { github: true },
      required: {
        executables: ["opencode", "codex"],
        providers: ["ollama", "anthropic"],
        models: ["qwen-local", "claude-sonnet"],
        plugins: ["github", "jira"]
      }
    });
    assert.deepEqual(report.missing.executables, ["codex"]);
    assert.deepEqual(report.missing.providers, ["anthropic"]);
    assert.deepEqual(report.missing.models, ["claude-sonnet"]);
    assert.deepEqual(report.missing.plugins, ["jira"]);
    assert.equal(report.provider_calls, 0);
  });
});

test("detectMachineModels returns deterministic local-only model suggestions", () => {
  const report = detectMachineModels({
    env: {
      OPENAI_API_KEY: "present",
      GITHUB_COPILOT_TOKEN: "present",
      ANTHROPIC_API_KEY: "present",
      GEMINI_API_KEY: "present"
    },
    socketPaths: ["/tmp/ollama.sock"],
    fileExists: (filePath) => filePath === "/tmp/ollama.sock"
  });

  assert.equal(report.status, "pass");
  assert.deepEqual(report.suggestions, [
    { provider: "ollama", model: "ollama/qwen2.5-coder:7b", source: "socket:/tmp/ollama.sock" },
    { provider: "openai", model: "openai/gpt-4.1-mini", source: "env:OPENAI_API_KEY" },
    { provider: "copilot", model: "copilot/gpt-4.1", source: "env:GITHUB_COPILOT_TOKEN" },
    { provider: "anthropic", model: "anthropic/claude-sonnet-4", source: "env:ANTHROPIC_API_KEY" },
    { provider: "gemini", model: "gemini/gemini-2.5-flash", source: "env:GEMINI_API_KEY" }
  ]);
  assert.equal(report.provider_calls, 0);
});

test("detectMachineModels prefers OLLAMA_HOST over socket probing", () => {
  const report = detectMachineModels({
    env: { OLLAMA_HOST: "http://127.0.0.1:11434" },
    socketPaths: ["/tmp/ollama.sock"],
    fileExists: () => true
  });

  assert.deepEqual(report.suggestions, [
    { provider: "ollama", model: "ollama/qwen2.5-coder:7b", source: "env:OLLAMA_HOST" }
  ]);
  assert.equal(report.provider_calls, 0);
});

test("component descriptor records GOI17/agents integration boundary", () => {
  const component = buildProfileManagerComponent();
  assert.equal(component.id, "profile-manager");
  assert.equal(component.package, "packages/profile-manager");
  assert.equal(component.source_repo, "https://github.com/GOI17/agents");
  assert.equal(component.provider_calls_allowed, 0);
});
