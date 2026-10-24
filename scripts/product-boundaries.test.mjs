import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
function fixture(t) {
  const path = mkdtempSync(join(tmpdir(), "alfred-product-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  for (const name of ["home", "project"]) mkdirSync(join(path, name));
  return path;
}
function copy(path, relative) { mkdirSync(dirname(join(path, relative)), { recursive: true }); cpSync(join(root, relative), join(path, relative), { recursive: true }); }
function run(path, entry, args) {
  const result = spawnSync(process.execPath, [join(path, entry), ...args], { cwd: join(path, "project"), env: { PATH: process.env.PATH, HOME: join(path, "home"), ALFRED_MEMORY_REGISTRY: join(path, "home/registry.sqlite") }, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message); return result.stdout + result.stderr;
}
test("neutral help and version load no capability package", t => {
  const f = fixture(t); copy(f, "packages/cli");
  assert.match(run(f, "packages/cli/scripts/alfred.mjs", ["--help"]), /Workspace, Memory and Agent Harness/);
  assert.match(run(f, "packages/cli/scripts/alfred.mjs", ["version"]), /alfred \d+\.\d+\.\d+/);
  for (const peer of ["workspace", "memory-server", "agent-harness"]) assert.equal(existsSync(join(f, "packages", peer)), false);
});
test("Memory lists its own local registry with CLI, Workspace, and Harness physically absent", t => {
  const f = fixture(t);
  for (const relative of ["packages/memory-server/package.json", "packages/memory-server/scripts/memory.mjs", "packages/memory-server/scripts/list.mjs", "packages/memory-server/src", "packages/memory-server/migrations", "packages/memory/package.json", "packages/memory/src"]) copy(f, relative);
  assert.match(run(f, "packages/memory-server/scripts/memory.mjs", ["--help"]), /alfred-memory/);
  assert.match(run(f, "packages/memory-server/scripts/memory.mjs", ["list"]), /"items": \[\]/);
  assert.equal(existsSync(join(f, "home/registry.sqlite")), true);
  for (const peer of ["cli", "workspace", "agent-harness"]) assert.equal(existsSync(join(f, "packages", peer)), false);
});
test("Harness inventories a project with CLI, Workspace, and Memory physically absent", t => {
  const f = fixture(t);
  for (const relative of ["packages/agent-harness", "packages/skill-manager/package.json", "packages/skill-manager/src"]) copy(f, relative);
  assert.match(run(f, "packages/agent-harness/scripts/cli.mjs", ["--help"]), /Agent Harness/);
  const output = JSON.parse(run(f, "packages/agent-harness/scripts/cli.mjs", ["skills", "list", "--scope", "project", "--json"]));
  assert.equal(output.status, "ok"); assert.equal(output.provider_calls, 0); assert.deepEqual(output.installations, []);
  for (const peer of ["cli", "workspace", "memory-server", "memory"]) assert.equal(existsSync(join(f, "packages", peer)), false);
});
test("neutral dispatch forwards arguments lazily, preserves aliases, and lets servers stay alive", t => {
  const f = fixture(t); copy(f, "packages/cli");
  const entries = { memory: "memory-server/scripts/memory.mjs", harness: "agent-harness/scripts/cli.mjs", workspace: "workspace/scripts/cli.mjs" };
  for (const [family, entry] of Object.entries(entries)) {
    mkdirSync(dirname(join(f, "packages", entry)), { recursive: true });
    writeFileSync(join(f, "packages", entry), `export async function run(args, env) { console.log(JSON.stringify({ family: ${JSON.stringify(family)}, args, home: env.HOME })); if(args[0] === "serve") setTimeout(() => console.log("server survived"), 10); return 0; }\n`);
  }
  for (const [args, family, forwarded] of [[['memory', 'list'], 'memory', ['list']], [['init', '--print-only'], 'memory', ['init', '--print-only']], [['skills', 'list'], 'harness', ['skills', 'list']], [['harness', 'runtime', 'status'], 'harness', ['runtime', 'status']]]) {
    const output = JSON.parse(run(f, "packages/cli/scripts/alfred.mjs", args));
    assert.equal(output.family, family); assert.deepEqual(output.args, forwarded); assert.equal(output.home, join(f, "home"));
  }
  assert.match(run(f, "packages/cli/scripts/alfred.mjs", ["workspace", "serve"]), /server survived/);
  rmSync(join(f, "packages/workspace"), { recursive: true }); rmSync(join(f, "packages/agent-harness"), { recursive: true });
  assert.equal(JSON.parse(run(f, "packages/cli/scripts/alfred.mjs", ["memory", "list"])).family, "memory");
});
test("standalone family sources do not import peer implementations", () => {
  const families = [
    { path: "packages/agent-harness", forbidden: /(?:\/|@alfred-labs\/)(?:memory(?:-server)?|workspace|cli)(?:\/|["'])/ },
    { path: "packages/memory-server/scripts", forbidden: /(?:\/|@alfred-labs\/)(?:agent-harness|workspace|cli)(?:\/|["'])/, shims: ["alfred.mjs", "runtime.mjs", "setup.mjs"] }
  ];
  function walk(base) { return readdirSync(base, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(base, entry.name)) : [join(base, entry.name)]); }
  for (const family of families) for (const file of walk(join(root, family.path))) {
    if (!/\.[cm]?js$/.test(file) || family.shims?.some(name => file === join(root, family.path, name))) continue;
    const imports = readFileSync(file, "utf8").match(/(?:from\s+|import\s*\(\s*)["'][^"']+["']/g) ?? [];
    for (const value of imports) assert.doesNotMatch(value, family.forbidden, file);
  }
});
