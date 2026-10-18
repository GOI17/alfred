import assert from "node:assert/strict";
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fixture, install, installPlan, makeSkill, put, receipt, rejectedPlan, selection, tree } from "./helpers.js";

for (const change of ["source", "target", "lock"]) {
  test(`apply rejects a stale ${change} snapshot`, async (t) => {
    const f = fixture(t);
    const { target } = await install(f);
    put(join(f.source, "references", "guide.md"), "Candidate v2.\n");
    const plan = await f.manager.plan({ operation: "update", name: "sample", ...selection });
    if (change === "source") put(join(f.source, "references", "guide.md"), "Unreviewed v3.\n");
    if (change === "target") put(join(target, "user-added.txt"), "User changes after preview.\n");
    if (change === "lock") {
      const another = makeSkill(join(f.root, "other-source"), { name: "another" });
      await install(f, { source: another });
    }
    const before = tree(target), beforeLock = readFileSync(f.lock);
    await assert.rejects(() => f.manager.apply(plan, { approval: true }), { code: "E_STALE_PLAN" });
    assert.deepEqual(tree(target), before);
    assert.deepEqual(readFileSync(f.lock), beforeLock);
  });
}

for (const operation of ["install", "update", "remove"]) {
  test(`${operation} failure between tree replacement and receipt write rolls back`, async (t) => {
    const f = fixture(t);
    let target;
    if (operation !== "install") target = (await install(f)).target;
    if (operation === "update") put(join(f.source, "references", "guide.md"), "Candidate update.\n");
    const manager = f.create({ beforeCommit: () => { throw new Error("QA simulated receipt failure"); } });
    const plan = await manager.plan({ operation, name: "sample", source: operation === "install" ? f.source : undefined, ...selection });
    target ??= plan.targetPath;
    const before = tree(target), beforeLock = existsSync(f.lock) ? readFileSync(f.lock) : null;
    await assert.rejects(() => manager.apply(plan, { approval: true }), /QA simulated receipt failure/);
    assert.deepEqual(tree(target), before);
    if (beforeLock === null) assert.equal(existsSync(f.lock), false);
    else assert.deepEqual(readFileSync(f.lock), beforeLock);
    const rows = f.manager.list(selection).installations;
    assert.equal(rows.length, operation === "install" ? 0 : 1, "Temporary backups are not discoverable installations");
    if (rows.length) assert.equal(rows[0].integrity, "intact");
  });
}

test("competing mutations cannot replace each other's receipt", { timeout: 10000 }, async (t) => {
  const f = fixture(t);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let entered;
  const enteredCommit = new Promise(resolve => { entered = resolve; });
  const first = f.create({ beforeCommit: async () => { entered(); await gate; } });
  const second = f.create();
  const one = await first.plan({ operation: "install", source: f.source, ...selection });
  const otherSource = makeSkill(join(f.root, "other-source"), { name: "other" });
  const two = await second.plan({ operation: "install", source: otherSource, ...selection });
  const applying = first.apply(one, { approval: true });
  try {
    await enteredCommit;
    await assert.rejects(() => second.apply(two, { approval: true }), /busy|lock|concurrent|progress|stale/i);
  } finally { release(); }
  await applying;
  assert.equal(receipt(f).installations.length, 1);
  assert.equal(receipt(f).installations[0].name, "sample");
});

for (const corruption of ["invalid-json", "unsupported-schema", "duplicate", "traversal", "invalid-digest", "wrong-scope"]) {
  test(`a ${corruption} lock cannot authorize mutation or become an empty lock`, async (t) => {
    const f = fixture(t);
    const { target } = await install(f);
    const lock = receipt(f);
    if (corruption === "unsupported-schema") lock.schemaVersion = 999;
    if (corruption === "duplicate") lock.installations.push({ ...lock.installations[0] });
    if (corruption === "traversal") lock.installations[0].targetPath = "../../outside";
    if (corruption === "invalid-digest") lock.installations[0].installedDigest = "sha256:not-a-digest";
    if (corruption === "wrong-scope") lock.installations[0].scope = "global";
    put(f.lock, corruption === "invalid-json" ? "{invalid" : JSON.stringify(lock));
    const beforeLock = readFileSync(f.lock), before = tree(target);
    try {
      const inventory = f.manager.list(selection);
      assert.ok(inventory.diagnostics.length > 0, "Invalid lock must have an explicit diagnostic");
    } catch (error) { assert.match(`${error.code} ${error.message}`, /lock|schema|duplicate|scope|digest|path/i); }
    await rejectedPlan(() => f.manager.plan({ operation: "remove", name: "sample", ...selection }), /lock|schema|duplicate|scope|digest|path/i);
    assert.deepEqual(readFileSync(f.lock), beforeLock);
    assert.deepEqual(tree(target), before);
  });
}

for (const location of ["source-file", "source-directory", "source-root", "target-parent", "state-parent", "state-file"]) {
  test(`rejects a symlink at ${location} without touching its referent`, async (t) => {
    const f = fixture(t);
    const outside = join(f.root, "outside");
    mkdirSync(outside);
    put(join(outside, "sentinel"), "Do not alter this file.\n");
    if (location === "source-file") symlinkSync(join(outside, "sentinel"), join(f.source, "escape.txt"));
    if (location === "source-directory") symlinkSync(outside, join(f.source, "linked"));
    if (location === "source-root") {
      renameSync(f.source, join(f.root, "real-source"));
      symlinkSync(join(f.root, "real-source"), f.source);
    }
    if (location === "target-parent") symlinkSync(outside, join(f.cwd, ".agents"));
    if (location === "state-parent") symlinkSync(outside, join(f.cwd, ".alfred"));
    if (location === "state-file") {
      mkdirSync(join(f.cwd, ".alfred"));
      put(join(outside, "lock.json"), '{"schemaVersion":1,"installations":[]}');
      symlinkSync(join(outside, "lock.json"), f.lock);
    }
    const before = tree(outside);
    await rejectedPlan(() => installPlan(f), /unsafe|symlink|symbolic|path|link/i);
    assert.deepEqual(tree(outside), before);
  });
}

test("apply rechecks target ancestors changed to a symlink after approval preview", async (t) => {
  const f = fixture(t);
  const plan = await installPlan(f);
  const outside = join(f.root, "outside");
  mkdirSync(outside);
  put(join(outside, "sentinel"), "Safe.\n");
  symlinkSync(outside, join(f.cwd, ".agents"));
  const before = tree(outside);
  await assert.rejects(() => f.manager.apply(plan, { approval: true }), /unsafe|symlink|path|stale/i);
  assert.deepEqual(tree(outside), before);
});

test("source hardlinks are rejected before materialization", async (t) => {
  const f = fixture(t);
  const outside = join(f.root, "external-file");
  put(outside, "Externally shared inode.\n");
  linkSync(outside, join(f.source, "shared.txt"));
  await rejectedPlan(() => installPlan(f), /hard.?link|unsafe|link/i);
  assert.equal(existsSync(f.lock), false);
});

test("source-control internals are excluded without dropping hidden resources", async (t) => {
  const f = fixture(t);
  put(join(f.source, ".git", "config"), "Repository metadata must not be installed.\n");
  put(join(f.source, ".resources", "guide.md"), "Required hidden resource.\n");
  const { target } = await install(f);
  assert.equal(existsSync(join(target, ".git")), false);
  assert.equal(readFileSync(join(target, ".resources", "guide.md"), "utf8"), "Required hidden resource.\n");
});

test("a source equal to its unmanaged destination cannot invent provenance", async (t) => {
  const f = fixture(t);
  const target = makeSkill(join(f.cwd, ".agents", "skills", "sample"));
  await rejectedPlan(() => installPlan(f, { source: target }));
  assert.equal(existsSync(f.lock), false);
});

for (const name of ["../escape", "/absolute", "bad/name", "..", ".hidden"]) {
  test(`unsafe skill name ${JSON.stringify(name)} cannot escape its target`, async (t) => {
    const f = fixture(t);
    makeSkill(f.source, { name });
    await rejectedPlan(() => installPlan(f), /name|path|invalid|unsafe/i);
    assert.equal(existsSync(f.lock), false);
  });
}


for (const directory of [".git", ".hg", ".svn"]) {
  test(`user-added ${directory} state is detected instead of deleted by update/remove`, async (t) => {
    const f = fixture(t);
    const { target } = await install(f);
    put(join(target, directory, "config"), "User-owned repository state.\n");
    const row = f.manager.info("sample", selection).installation;
    assert.ok(["modified", "invalid"].includes(row.integrity), "Source exclusions must not hide installed changes");
    const before = tree(target), beforeLock = readFileSync(f.lock);
    for (const operation of ["update", "remove"]) await rejectedPlan(() => f.manager.plan({ operation, name: "sample", ...selection }));
    assert.deepEqual(tree(target), before);
    assert.deepEqual(readFileSync(f.lock), beforeLock);
  });
}

test("failure after writing the receipt restores both prior receipt and skill bytes", async (t) => {
  const f = fixture(t);
  const { target } = await install(f);
  const before = tree(target), beforeLock = readFileSync(f.lock);
  put(join(f.source, "references", "guide.md"), "Candidate newer reference.\n");
  const plan = await f.manager.plan({ operation: "update", name: "sample", ...selection });
  const traceRoot = join(f.cwd, ".alfred", "observability");
  rmSync(traceRoot, { recursive: true });
  put(traceRoot, "A pre-existing file prevents trace directory creation.\n");
  await assert.rejects(() => f.manager.apply(plan, { approval: true }), /directory|ENOTDIR|EEXIST|Ancestor/i);
  assert.deepEqual(tree(target), before);
  assert.deepEqual(readFileSync(f.lock), beforeLock);
  assert.equal(f.manager.info("sample", selection).installation.integrity, "intact");
});

test("a FIFO source fails promptly without opening a blocking stream", (t) => {
  const f = fixture(t);
  const fifo = join(f.source, "special-pipe");
  const created = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr);
  const sourceModule = resolve(import.meta.dirname, "../src/index.js");
  const code = `
    import { pathToFileURL } from 'node:url';
    const { createSkillManager } = await import(pathToFileURL(process.argv[1]));
    const manager = createSkillManager({ cwd: process.argv[2], home: process.argv[3], env: {} });
    try {
      const plan = await manager.plan({ operation: 'install', source: process.argv[4], harness: 'codex', scope: 'project' });
      process.exitCode = plan.status === 'blocked' ? 0 : 2;
    } catch (error) {
      if (error.code !== 'E_UNSAFE_PATH') { console.error(error); process.exitCode = 3; }
    }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code, sourceModule, f.cwd, f.home, f.source], { encoding: "utf8", timeout: 3000 });
  assert.equal(result.error, undefined, "FIFO acquisition must not hang until subprocess timeout");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(f.lock), false);
});


test("remove preserves concurrent replacement and its original backup with an explicit recovery diagnostic", async (t) => {
  const f = fixture(t);
  const { target } = await install(f);
  const original = tree(target), originalLock = readFileSync(f.lock);
  const manager = f.create({ beforeCommit: ({ targetPath }) => put(join(targetPath, "USER.txt"), "A concurrent user-created replacement.\n") });
  const plan = await manager.plan({ operation: "remove", name: "sample", ...selection });
  await assert.rejects(() => manager.apply(plan, { approval: true }), { code: "E_RECOVERY_REQUIRED" });
  assert.equal(readFileSync(join(target, "USER.txt"), "utf8"), "A concurrent user-created replacement.\n");
  assert.deepEqual(readFileSync(f.lock), originalLock);
  const traceRoot = join(f.cwd, ".alfred", "observability");
  const traces = readdirSync(traceRoot).map(file => JSON.parse(readFileSync(join(traceRoot, file), "utf8")));
  const failure = traces.find(trace => trace.data.recovery_required === true);
  assert.ok(failure, "Recovery path is persisted in the failure trace");
  assert.deepEqual(tree(join(failure.data.recovery_path, "previous")), original);
});
