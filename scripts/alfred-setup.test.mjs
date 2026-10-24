#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const cli = join(root, "packages/memory-server/scripts/alfred.mjs");

function runSetup(extraEnv = {}) {
  const home = mkdtempSync(join(tmpdir(), "alfred-setup-test-"));
  const result = spawnSync(process.execPath, [
    cli,
    "setup",
    "--edition=coding",
    "--name=setup-test",
    "--harness=none"
  ], {
    cwd: home,
    encoding: "utf8",
    env: { ...process.env, HOME: home, ...extraEnv }
  });
  return { home, result };
}

test("neutral CLI and legacy shim expose identical product setup help on stdout", () => {
  const results = [join(root, "packages/cli/scripts/alfred.mjs"), cli].map(entry =>
    spawnSync(process.execPath, [entry, "--help"], { cwd: root, encoding: "utf8" }));
  for (const result of results) {
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Usage: alfred <capability> <command>/);
    for (const capability of ["workspace", "memory", "harness"]) assert.match(result.stdout, new RegExp(`^  ${capability}\\s+`, "m"));
    assert.match(result.stdout, /setup\s+Choose capabilities and review product updates/);
  }
  assert.equal(results[0].stdout, results[1].stdout);
});

test("previews source setup without writing the user home", () => {
  const { home, result } = runSetup();
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ALFRED SUITE INSTALL PREVIEW/);
    assert.match(result.stdout, new RegExp(`Target path:\\s+${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\/\.alfred\/installs\/setup-test`));
    assert.match(result.stdout, /Provider calls:\s+0/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /model strategy|model approval|models\.json/i);
    assert.deepEqual(readdirSync(home), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("apply preserves user-owned model assignment outside setup", () => {
  const home = mkdtempSync(join(tmpdir(), "alfred-setup-model-preserve-"));
  const target = join(home, "existing-install");
  const modelsPath = join(home, ".alfred", "models.json");
  mkdirSync(target, { recursive: true });
  mkdirSync(join(home, ".alfred"), { recursive: true });
  writeFileSync(modelsPath, '{\n  "*": { "primary": "existing/model" },\n  "fallbacks": []\n}\n', { mode: 0o600 });
  const before = readFileSync(modelsPath);
  const result = spawnSync(process.execPath, [
    cli,
    "setup",
    "--edition=coding",
    "--name=model-preserve",
    "--harness=none",
    `--path=${target}`,
    "--no-clone",
    "--apply"
  ], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, HOME: home }
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(modelsPath), before);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /model strategy|model approval|models\.json/i);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("reuses the packaged root for Homebrew setup", () => {
  const { home, result } = runSetup({ ALFRED_DISTRIBUTION: "homebrew" });
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`Target path:\\s+${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(result.stdout, /No files were written/);
    assert.match(result.stdout, /alfred setup --edition=/);
    assert.match(result.stdout, /alfred runtime init --instructions/);
    assert.doesNotMatch(result.stdout, /raw\.githubusercontent\.com|curl -/);
    assert.deepEqual(readdirSync(home), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
