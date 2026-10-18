import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fixture, makeSkill, tree } from "./helpers.js";

const cli = resolve(import.meta.dirname, "../../memory-server/scripts/alfred.mjs");
function run(f, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: f.cwd, encoding: "utf8", timeout: 15000,
    env: { ...process.env, HOME: f.home, CODEX_HOME: join(f.home, ".codex"), XDG_CONFIG_HOME: join(f.home, ".config"), ALFRED_DEBUG: "0" }
  });
}
function json(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

test("main CLI dispatches skills and every command documents its own help", (t) => {
  const f = fixture(t);
  const main = run(f, ["--help"]);
  assert.equal(main.status, 0);
  assert.match(`${main.stdout}\n${main.stderr}`, /skills\s/);
  for (const command of [[], ["list"], ["info"], ["install"], ["update"], ["remove"]]) {
    const result = run(f, ["skills", ...command, "--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(`${result.stdout}\n${result.stderr}`, /skills/i);
  }
});

test("CLI inventory JSON is machine-readable and leaves an empty project and home unchanged", (t) => {
  const f = fixture(t);
  const output = json(run(f, ["skills", "list", "--json"]));
  assert.deepEqual(output.installations, []);
  assert.equal(output.provider_calls, 0);
  assert.deepEqual(readdirSync(f.cwd), []);
  assert.deepEqual(readdirSync(f.home), []);
});

test("CLI preview, dry-run, apply, info, update and remove form a local lifecycle", (t) => {
  const f = fixture(t);
  const args = ["skills", "install", f.source, "--harness", "codex", "--json"];
  const preview = json(run(f, args));
  assert.equal(preview.status, "preview");
  assert.equal(existsSync(preview.targetPath), false);
  const dry = json(run(f, [...args, "--apply", "--dry-run"]));
  assert.equal(dry.status, "preview");
  assert.equal(existsSync(preview.targetPath), false);
  const applied = json(run(f, [...args, "--apply"]));
  assert.equal(applied.status, "applied");
  assert.equal(existsSync(preview.targetPath), true);
  const info = json(run(f, ["skills", "info", "sample", "--harness=codex", "--scope=project", "--json"]));
  assert.equal(info.installation.management, "managed");
  assert.equal(info.installation.integrity, "intact");
  assert.equal(info.installation.declaredVersion, "1.2.3");
  const update = json(run(f, ["skills", "update", "sample", "--harness=codex", "--apply", "--json"]));
  assert.equal(update.status, "unchanged");
  const remove = json(run(f, ["skills", "remove", "sample", "--harness=codex", "--json"]));
  assert.equal(remove.status, "preview");
  assert.equal(existsSync(preview.targetPath), true);
  assert.equal(json(run(f, ["skills", "remove", "sample", "--harness=codex", "--apply", "--json"])).status, "applied");
  assert.equal(existsSync(preview.targetPath), false);
});

test("CLI rejects unknown flags, missing values, missing names and unsupported harnesses", (t) => {
  const f = fixture(t);
  for (const args of [
    ["list", "--made-up"], ["list", "--scope"], ["list", "--scope=invalid"],
    ["info"], ["install"], ["update"], ["remove"], ["unknown"],
    ["install", f.source, "--harness=pi"], ["list", "--harness=claude"]
  ]) {
    const result = run(f, ["skills", ...args]);
    assert.notEqual(result.status, 0, `Should fail: ${JSON.stringify(args)}`);
    assert.ok(`${result.stderr}${result.stdout}`.trim().length > 0, "Argument errors include an actionable diagnostic");
  }
  assert.deepEqual(readdirSync(f.cwd), []);
});

test("CLI refuses ambiguous harness inference and shows destination when inference succeeds", (t) => {
  const f = fixture(t);
  makeSkill(join(f.cwd, ".agents", "skills", "legacy"), { name: "legacy" });
  makeSkill(join(f.cwd, ".opencode", "skills", "legacy"), { name: "legacy" });
  const before = tree(f.cwd);
  const output = run(f, ["skills", "install", f.source]);
  assert.notEqual(output.status, 0);
  assert.match(`${output.stderr}\n${output.stdout}`, /harness|ambiguous|select/i);
  assert.deepEqual(tree(f.cwd), before);
});

test("human inventory distinguishes declared versions and unknown provenance without claiming activation", (t) => {
  const f = fixture(t);
  makeSkill(join(f.cwd, ".agents", "skills", "legacy"), { name: "legacy", version: null });
  const result = run(f, ["skills", "list"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /legacy/);
  assert.match(result.stdout, /unmanaged/i);
  assert.match(result.stdout, /unknown|unverified|—/i);
  assert.doesNotMatch(result.stdout, /currently loaded|currently active/i);
  assert.equal(existsSync(f.lock), false);
});

test("--cwd scopes changes to the requested worktree instead of the invoking directory", (t) => {
  const f = fixture(t);
  const other = join(f.root, "another-worktree");
  makeSkill(join(other, "source-placeholder"), { name: "placeholder" });
  const output = json(run(f, ["skills", "install", f.source, "--harness=codex", "--cwd", other, "--apply", "--json"]));
  assert.equal(output.targetPath, join(other, ".agents", "skills", "sample"));
  assert.equal(existsSync(f.lock), false);
  assert.ok(readFileSync(join(other, ".alfred", "skills-lock.json"), "utf8").includes("sample"));
});


test("human apply displays its reviewable plan before the applied result", (t) => {
  const f = fixture(t);
  const result = run(f, ["skills", "install", f.source, "--harness=codex", "--apply"]);
  assert.equal(result.status, 0, result.stderr);
  const preview = result.stdout.indexOf("PREVIEW:");
  const applied = result.stdout.indexOf("APPLIED:");
  assert.ok(preview >= 0 && applied > preview);
  assert.match(result.stdout.slice(preview, applied), /Destination:.*\.agents\/skills\/sample/);
});
