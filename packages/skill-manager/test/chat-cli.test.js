import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { validateSkillDirectory } from "../src/index.js";
import { fixture, put, tree } from "./helpers.js";

const cli = resolve(import.meta.dirname, "../../memory-server/scripts/alfred.mjs");
function run(f, args, { mockCatalog = false } = {}) {
  const imports = [];
  if (mockCatalog) {
    const bootstrap = join(f.root, "fetch-fixture.mjs");
    put(bootstrap, `import fs from 'node:fs';
      globalThis.fetch = async (input, options) => {
        const url = new URL(String(input));
        if (url.origin !== 'https://skills.sh') throw new Error('Unexpected host');
        fs.appendFileSync(${JSON.stringify(join(f.root, "requests.jsonl"))}, JSON.stringify({url:String(input),authorization:new Headers(options.headers).get('authorization')})+'\\n');
        return Response.json({skills:[{id:'example/skills/testing',source:'example/skills',skillId:'testing',name:'Testing',installs:7}],count:1});
      };`);
    imports.push("--import", bootstrap);
  }
  return spawnSync(process.execPath, [...imports, cli, "skills", ...args], {
    cwd: f.cwd, encoding: "utf8", timeout: 15000,
    env: { ...process.env, HOME: f.home, CODEX_HOME: join(f.home, ".codex"), XDG_CONFIG_HOME: join(f.home, ".config") }
  });
}
function parsed(result) { assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`); return JSON.parse(result.stdout); }

test("CLI search normalizes positional words and returns source links without installation", (t) => {
  const f = fixture(t);
  const result = parsed(run(f, ["search", "react", "testing", "--limit=3", "--json"], { mockCatalog: true }));
  assert.equal(result.query, "react testing");
  assert.equal(result.results[0].repository, "https://github.com/example/skills");
  const request = JSON.parse(readFileSync(join(f.root, "requests.jsonl"), "utf8").trim());
  assert.equal(new URL(request.url).searchParams.get("q"), "react testing");
  assert.equal(new URL(request.url).searchParams.get("limit"), "3");
  assert.equal(request.authorization, null);
  assert.deepEqual(readdirSync(f.cwd), []);
  assert.deepEqual(readdirSync(f.home), []);
});

test("CLI forwards shell-looking search text as literal query data", (t) => {
  const f = fixture(t);
  const marker = join(f.cwd, "should-not-exist");
  const query = `testing; $(touch ${marker})`;
  const result = parsed(run(f, ["search", query, "--json"], { mockCatalog: true }));
  assert.equal(result.query, query);
  assert.equal(existsSync(marker), false);
});

test("search rejects mutation/target flags and malformed limits before any network call", (t) => {
  const f = fixture(t);
  for (const option of ["--apply", "--dry-run", "--scope=project", "--harness=codex", "--skill=skills/testing", "--name=testing", "--ref=main", "--expected-digest=bad", "--limit=0", "--limit=21", "--limit=1.5"]) {
    const result = run(f, ["search", "testing", option, "--json"], { mockCatalog: true });
    assert.notEqual(result.status, 0, option);
    assert.equal(JSON.parse(result.stdout).status, "failed");
  }
  assert.equal(existsSync(join(f.root, "requests.jsonl")), false);
  assert.deepEqual(readdirSync(f.cwd), []);
});

test("CLI add binds a fresh apply to the reviewed digest across subprocesses", (t) => {
  const f = fixture(t);
  const base = ["add", f.source, "--harness=codex", "--json"];
  const reviewed = parsed(run(f, base));
  put(join(f.source, "references", "guide.md"), "Changed after the conversation preview.\n");
  const failed = run(f, [...base, "--apply", "--expected-digest", reviewed.candidate.installedDigest]);
  assert.notEqual(failed.status, 0);
  assert.equal(JSON.parse(failed.stdout).error.code, "E_STALE_PLAN");
  assert.equal(existsSync(reviewed.targetPath), false);
  assert.equal(existsSync(f.lock), false);
  const updated = parsed(run(f, base));
  const applied = parsed(run(f, [...base, "--apply", "--expected-digest", updated.candidate.installedDigest]));
  assert.equal(applied.status, "applied");
  assert.equal(applied.operation, "install");
});

test("review guards require apply and read commands reject them", (t) => {
  const f = fixture(t);
  const digest = `sha256:${"a".repeat(64)}`;
  for (const args of [
    ["add", f.source, "--harness=codex", "--expected-digest", digest],
    ["add", f.source, "--harness=codex", "--expected-commit", "a".repeat(40)],
    ["list", "--expected-digest", digest], ["info", "sample", "--expected-commit", "a".repeat(40)],
    ["list", "--apply", "--expected-digest", digest]
  ]) assert.notEqual(run(f, [...args, "--json"]).status, 0, JSON.stringify(args));
  assert.deepEqual(readdirSync(f.cwd), []);
});

test("dry-run overrides guarded apply without live writes", (t) => {
  const f = fixture(t);
  const base = ["add", f.source, "--harness=codex", "--json"];
  const preview = parsed(run(f, base));
  const dry = parsed(run(f, [...base, "--apply", "--dry-run", "--expected-digest", preview.candidate.installedDigest]));
  assert.equal(dry.status, "preview");
  assert.equal(existsSync(preview.targetPath), false);
  assert.equal(existsSync(f.lock), false);
});

test("a useful local draft validates without requiring a harness or creating an installation receipt", (t) => {
  const f = fixture(t);
  const before = tree(f.source);
  const result = validateSkillDirectory(f.source, { cwd: f.cwd });
  assert.equal(result.status, "valid");
  assert.equal(result.name, "sample");
  assert.match(result.digest, /^sha256:[a-f0-9]{64}$/);
  assert.ok(result.files.includes("references/guide.md"));
  const output = parsed(run(f, ["validate", f.source, "--json"]));
  assert.equal(output.digest, result.digest);
  assert.deepEqual(tree(f.source), before);
  assert.deepEqual(readdirSync(f.cwd), []);
  assert.deepEqual(readdirSync(f.home), []);
});

test("draft validation rejects frontmatter-only scaffolds and mutation flags", (t) => {
  const f = fixture(t);
  put(join(f.source, "SKILL.md"), "---\nname: sample\ndescription: Only a scaffold.\n---\n\n");
  assert.throws(() => validateSkillDirectory(f.source, { cwd: f.cwd }), /body|empty|content|instruction/i);
  for (const option of ["--apply", "--scope=global", "--harness=codex"]) assert.notEqual(run(f, ["validate", f.source, option, "--json"]).status, 0);
  assert.equal(existsSync(f.lock), false);
});

test("create stays a chat authoring workflow and does not silently scaffold or install", (t) => {
  const f = fixture(t);
  const help = run(f, ["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /create/);
  assert.match(help.stdout, /chat|conversation/i);
  assert.notEqual(run(f, ["create", "release-notes", "--json"]).status, 0);
  assert.deepEqual(readdirSync(f.cwd), []);
  assert.deepEqual(readdirSync(f.home), []);
});
