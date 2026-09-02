#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
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
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, HOME: home, ...extraEnv }
  });
  return { home, result };
}

test("exposes setup in the main CLI help", () => {
  const result = spawnSync(process.execPath, [cli, "--help"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /setup\s+Configure Alfred/);
});

test("previews source setup without writing the user home", () => {
  const { home, result } = runSetup();
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ALFRED SUITE INSTALL PREVIEW/);
    assert.match(result.stdout, new RegExp(`Target path:\\s+${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\/\.alfred\/installs\/setup-test`));
    assert.match(result.stdout, /Provider calls:\s+0/);
    assert.deepEqual(readdirSync(home), []);
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
    assert.deepEqual(readdirSync(home), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
