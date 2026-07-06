#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const root = process.cwd();
const installSh = resolve(root, "install.sh");
const fixture = mkdtempSync(join(tmpdir(), "alfred-suite-install-"));
const home = join(fixture, "home");
const cwd = join(fixture, "workspace");
mkdirSync(home, { recursive: true });
mkdirSync(cwd, { recursive: true });

function run(args, options = {}) {
  return spawnSync("sh", [installSh, ...args], {
    cwd: options.cwd ?? cwd,
    env: { ...process.env, HOME: home, PATH: process.env.PATH ?? "" },
    encoding: "utf8"
  });
}

try {
  const syntax = spawnSync("sh", ["-n", installSh], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);

  const preview = run(["--edition=coding", "--name=acme"]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /ALFRED SUITE INSTALL PREVIEW/);
  assert.match(preview.stdout, /Edition:\s+coding/);
  assert.match(preview.stdout, /Name:\s+acme/);
  assert.match(preview.stdout, /No files were written/);
  assert.doesNotMatch(preview.stdout, /Installing Alfred Pi Agent/);
  assert.equal(existsSync(join(cwd, "AGENTS.md")), false, "preview must not create AGENTS.md");
  assert.equal(existsSync(join(cwd, ".alfred")), false, "preview must not create .alfred in cwd");

  const legacy = run(["--profile=coding", "--name=acme"]);
  assert.notEqual(legacy.status, 0);
  assert.match(legacy.stderr, /--profile is legacy/);

  const unknown = run(["--edition=coding", "--name=acme", "--surprise"]);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown flag: --surprise/);

  const target = join(fixture, "existing-alfred-repo");
  mkdirSync(target, { recursive: true });
  const applied = run(["--edition=coding", "--name=acme", "--path", target, "--apply", "--no-clone", "--harness=none"]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /ALFRED SUITE INSTALL APPLIED/);
  assert.equal(existsSync(join(home, ".alfred", "runtime-profiles", "profiles")), true);
  assert.equal(existsSync(join(home, ".alfred", "runtime-profiles", "profiles.local")), true);
  assert.equal(existsSync(join(home, ".alfred", "observability", "install-trace.json")), true);
  const trace = JSON.parse(readFileSync(join(home, ".alfred", "observability", "install-trace.json"), "utf8"));
  assert.equal(trace.actor, "alfred-suite-install");
  assert.equal(trace.data.edition, "coding");
  assert.equal(trace.data.provider_calls, 0);

  console.log("suite installer validation ok: preview is default, legacy flags fail closed, and apply does not install Pi by default");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
