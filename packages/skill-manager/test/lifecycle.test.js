import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { assertTrace, fixture, install, installPlan, makeSkill, put, receipt, rejectedPlan, selection, tree } from "./helpers.js";

test("local preview needs explicit approval and dry-run cannot apply", async (t) => {
  const f = fixture(t);
  const plan = await installPlan(f);
  assert.equal(plan.status, "preview");
  assert.equal(plan.action, "install");
  assert.equal(plan.targetPath, join(f.cwd, ".agents", "skills", "sample"));
  assert.equal(plan.candidate.declaredVersion, "1.2.3");
  assert.match(plan.candidate.installedDigest, /^sha256:[a-f0-9]{64}$/);
  assert.ok(plan.candidate.files.includes("references/guide.md"));
  assertTrace(plan);
  assert.deepEqual(readdirSync(f.cwd), []);
  assert.deepEqual(readdirSync(f.home), []);
  await assert.rejects(() => f.manager.apply(plan), { code: "E_APPROVAL_REQUIRED" });
  const dry = await f.manager.apply(plan, { approval: true, dryRun: true });
  assert.equal(dry.status, "preview");
  assert.equal(existsSync(plan.targetPath), false);
  assert.equal(existsSync(f.lock), false);
});

test("local apply records actual package identity and copies resources plus executable mode", async (t) => {
  const f = fixture(t);
  const { target, result } = await install(f);
  assert.deepEqual(tree(target), tree(f.source));
  const lock = receipt(f);
  assert.equal(lock.schemaVersion, 1);
  assert.equal(lock.installations.length, 1);
  const entry = lock.installations[0];
  assert.equal(entry.name, "sample");
  assert.equal(entry.targetPath, ".agents/skills/sample");
  assert.deepEqual(entry.source, { kind: "local", path: f.source });
  assert.equal(entry.declaredVersion, "1.2.3");
  assert.equal(entry.installedDigest, entry.sourceDigest);
  assert.match(entry.installedDigest, /^sha256:[a-f0-9]{64}$/);
  assert.ok(Number.isFinite(Date.parse(entry.installedAt)));
  const row = f.manager.info("sample", selection).installation;
  assert.equal(row.management, "managed");
  assert.equal(row.integrity, "intact");
  assert.equal(row.installedDigest, row.observedDigest);
  assertTrace(result);
  const observation = join(f.cwd, ".alfred", "observability");
  assert.ok(existsSync(observation), "Applied operation persists a trace");
});

test("an unchanged update preserves receipt bytes and installation timestamps", async (t) => {
  const f = fixture(t);
  const { target } = await install(f);
  const before = readFileSync(f.lock);
  const modified = statSync(join(target, "SKILL.md")).mtimeMs;
  const plan = await f.manager.plan({ operation: "update", name: "sample", ...selection });
  assert.equal(plan.status, "unchanged");
  const result = await f.manager.apply(plan, { approval: true });
  assert.equal(result.status, "unchanged");
  assert.deepEqual(readFileSync(f.lock), before);
  assert.equal(statSync(join(target, "SKILL.md")).mtimeMs, modified);
});

test("update changes installed digest even if declared version is unchanged", async (t) => {
  const f = fixture(t);
  const { target } = await install(f);
  const previous = receipt(f).installations[0];
  put(join(f.source, "references", "guide.md"), "Changed reference.\n");
  const plan = await f.manager.plan({ operation: "update", name: "sample", ...selection });
  assert.equal(plan.status, "preview");
  assert.notEqual(plan.candidate.installedDigest, previous.installedDigest);
  assert.equal(plan.candidate.declaredVersion, previous.declaredVersion);
  assert.equal(readFileSync(join(target, "references", "guide.md"), "utf8"), "Reference information.\n");
  await f.manager.apply(plan, { approval: true });
  assert.deepEqual(tree(target), tree(f.source));
  assert.equal(receipt(f).installations[0].installedAt, previous.installedAt);
});

for (const modification of ["edit", "add", "delete", "executable-mode"]) {
  test(`inventory detects ${modification} and update/remove cannot discard it`, async (t) => {
    const f = fixture(t);
    const { target } = await install(f);
    if (modification === "edit") put(join(target, "references", "guide.md"), "User custom notes.\n");
    if (modification === "add") put(join(target, "local-notes.md"), "User custom file.\n");
    if (modification === "delete") rmSync(join(target, "references", "guide.md"));
    if (modification === "executable-mode") chmodSync(join(target, "scripts", "check.sh"), 0o644);
    const row = f.manager.info("sample", selection).installation;
    assert.equal(row.integrity, "modified");
    assert.equal(row.management, "managed");
    const before = tree(target), beforeLock = readFileSync(f.lock);
    for (const operation of ["update", "remove"]) {
      const plan = await f.manager.plan({ operation, name: "sample", ...selection });
      assert.equal(plan.status, "blocked");
      await assert.rejects(() => f.manager.apply(plan, { approval: true }), { code: "E_BLOCKED" });
    }
    assert.deepEqual(tree(target), before);
    assert.deepEqual(readFileSync(f.lock), beforeLock);
  });
}

test("missing installation stays visible and cannot be updated or removed implicitly", async (t) => {
  const f = fixture(t);
  const { target } = await install(f);
  rmSync(target, { recursive: true });
  const row = f.manager.info("sample", selection).installation;
  assert.equal(row.management, "managed");
  assert.equal(row.integrity, "missing");
  for (const operation of ["update", "remove"]) await rejectedPlan(() => f.manager.plan({ operation, name: "sample", ...selection }));
  assert.equal(receipt(f).installations.length, 1);
});

test("legacy discovery is honest, offline and does not create a receipt", async (t) => {
  let requests = 0;
  const f = fixture(t, { fetch: () => { requests++; throw new Error("Network forbidden for inventory"); } });
  const target = join(f.cwd, ".agents", "skills", "sample");
  makeSkill(target, { version: null });
  const before = tree(f.cwd);
  const output = f.manager.list();
  assertTrace(output);
  assert.equal(output.installations.length, 1);
  const row = output.installations[0];
  assert.equal(row.management, "unmanaged");
  assert.equal(row.source, null);
  assert.equal(row.installedDigest, null);
  assert.equal(row.declaredVersion, null);
  assert.equal(f.manager.info("sample", selection).installation.management, "unmanaged");
  assert.equal(requests, 0);
  assert.deepEqual(tree(f.cwd), before);
  assert.equal(existsSync(f.lock), false);
  for (const operation of ["update", "remove"]) await rejectedPlan(() => f.manager.plan({ operation, name: "sample", ...selection }));
});

test("explicit exact-content adoption records provenance without rewriting existing files", async (t) => {
  const f = fixture(t);
  const target = join(f.cwd, ".agents", "skills", "sample");
  cpSync(f.source, target, { recursive: true });
  const path = join(target, "SKILL.md");
  const beforeStat = statSync(path), before = tree(target);
  const plan = await installPlan(f);
  assert.equal(plan.action, "adopt");
  assert.equal(plan.status, "preview");
  assert.equal(existsSync(f.lock), false);
  await f.manager.apply(plan, { approval: true });
  assert.equal(statSync(path).ino, beforeStat.ino);
  assert.equal(statSync(path).mtimeMs, beforeStat.mtimeMs);
  assert.deepEqual(tree(target), before);
  assert.equal(f.manager.info("sample", selection).installation.management, "managed");
  assert.equal(receipt(f).installations[0].source.path, f.source);
  assert.equal(receipt(f).installations[0].installedAt, null, "Adoption cannot invent a historic installation time");
  assert.ok(Number.isFinite(Date.parse(receipt(f).installations[0].managedSince)));
});

test("name similarity does not permit adoption when content differs", async (t) => {
  const f = fixture(t);
  const target = join(f.cwd, ".agents", "skills", "sample");
  makeSkill(target, { body: "An older bundled skill with unknown provenance.\n" });
  const before = tree(target);
  await rejectedPlan(() => installPlan(f));
  assert.deepEqual(tree(target), before);
  assert.equal(existsSync(f.lock), false);
});

test("remove is preview-first and preserves sibling skills and harness configuration", async (t) => {
  const f = fixture(t);
  const { target } = await install(f);
  const sibling = join(f.cwd, ".agents", "skills", "other");
  makeSkill(sibling, { name: "other" });
  put(join(f.cwd, ".agents", "user-config.txt"), "Existing user configuration.\n");
  const siblingBefore = tree(sibling);
  const plan = await f.manager.plan({ operation: "remove", name: "sample", ...selection });
  assert.equal(plan.status, "preview");
  assert.ok(existsSync(target));
  await f.manager.apply(plan, { approval: true });
  assert.equal(existsSync(target), false);
  assert.equal(receipt(f).installations.length, 0);
  assert.deepEqual(tree(sibling), siblingBefore);
  assert.equal(readFileSync(join(f.cwd, ".agents", "user-config.txt"), "utf8"), "Existing user configuration.\n");
});

test("scope/harness installations remain independent and ambiguous info refuses a guess", async (t) => {
  const f = fixture(t);
  for (const scope of ["project", "global"]) for (const harness of ["codex", "opencode"]) await install(f, { scope, harness });
  const result = f.manager.list();
  assert.equal(result.installations.length, 4);
  assert.equal(new Set(result.installations.map(row => row.targetPath)).size, 4);
  assert.equal(receipt(f).installations.length, 2);
  assert.equal(receipt(f, "global").installations.length, 2);
  assert.throws(() => f.manager.info("sample"), /ambiguous|select|multiple/i);
  const globalBefore = readFileSync(join(f.home, ".alfred", "skills-lock.json"));
  const plan = await f.manager.plan({ operation: "remove", name: "sample", ...selection });
  await f.manager.apply(plan, { approval: true });
  assert.equal(f.manager.list().installations.length, 3);
  assert.deepEqual(readFileSync(join(f.home, ".alfred", "skills-lock.json")), globalBefore);
});

test("missing local source blocks update while installed bytes remain usable", async (t) => {
  const f = fixture(t);
  const { target } = await install(f);
  const before = tree(target), beforeLock = readFileSync(f.lock);
  rmSync(f.source, { recursive: true });
  await rejectedPlan(() => f.manager.plan({ operation: "update", name: "sample", ...selection }));
  assert.deepEqual(tree(target), before);
  assert.deepEqual(readFileSync(f.lock), beforeLock);
});


test("global destinations honor native roots and absolute XDG configuration without CODEX_HOME drift", async (t) => {
  const f = fixture(t);
  const xdg = join(f.home, "custom-xdg");
  const manager = f.create({ env: { XDG_CONFIG_HOME: xdg, CODEX_HOME: join(f.home, "custom-codex") } });
  const codex = await manager.plan({ operation: "install", source: f.source, harness: "codex", scope: "global" });
  assert.equal(codex.targetPath, join(f.home, ".agents", "skills", "sample"));
  const opencode = await manager.plan({ operation: "install", source: f.source, harness: "opencode", scope: "global" });
  assert.equal(opencode.targetPath, join(xdg, "opencode", "skills", "sample"));
  assert.equal(existsSync(f.lock), false);
});

test("relative XDG_CONFIG_HOME cannot redirect global writes into a project", async (t) => {
  const f = fixture(t);
  await rejectedPlan(() => f.create({ env: { XDG_CONFIG_HOME: "relative-xdg" } }).plan({ operation: "install", source: f.source, harness: "opencode", scope: "global" }), /XDG|absolute|path|invalid/i);
  assert.deepEqual(readdirSync(f.cwd), []);
});


for (const alias of [false, true]) {
  test(`inventory deduplicates the physical Codex root when cwd ${alias ? "aliases" : "equals"} home`, async (t) => {
    const f = fixture(t);
    const cwd = alias ? join(f.root, "home-alias") : f.home;
    if (alias) symlinkSync(f.home, cwd);
    const manager = f.create({ cwd });
    const plan = await manager.plan({ operation: "install", source: f.source, harness: "codex", scope: "global" });
    await manager.apply(plan, { approval: true });
    const inventory = manager.list();
    assert.equal(inventory.installations.length, 1);
    assert.equal(inventory.installations[0].management, "managed");
    assert.equal(inventory.installations[0].integrity, "intact");
    assert.equal(inventory.installations[0].targetPath, join(f.home, ".agents", "skills", "sample"));
    const removal = await manager.plan({ operation: "remove", name: "sample", harness: "codex", scope: "global" });
    await manager.apply(removal, { approval: true });
    assert.equal(manager.list().installations.length, 0);
  });
}


test("project mutation from home refuses ambiguous global state without silently broadening scope", async (t) => {
  const f = fixture(t);
  const manager = f.create({ cwd: f.home });
  for (const harness of ["codex", "opencode"]) {
    await rejectedPlan(() => manager.plan({ operation: "install", source: f.source, harness, scope: "project" }), /scope|home|global|alias/i);
  }
  assert.deepEqual(readdirSync(f.home), []);
  const approved = await manager.plan({ operation: "install", source: f.source, harness: "codex", scope: "global" });
  await manager.apply(approved, { approval: true });
  const fromAnotherProject = f.manager.list();
  assert.equal(fromAnotherProject.installations.length, 1);
  assert.equal(fromAnotherProject.installations[0].scope, "global");
  assert.equal(fromAnotherProject.installations[0].integrity, "intact");
});


test("update preview includes a resource removed from its candidate snapshot", async (t) => {
  const f = fixture(t);
  const { target } = await install(f);
  const removed = "assets/binary.dat";
  const before = readFileSync(join(target, removed));
  rmSync(join(f.source, removed));
  const plan = await f.manager.plan({ operation: "update", name: "sample", ...selection });
  assert.equal(plan.status, "preview");
  assert.ok(plan.files.includes(removed), "The reviewable plan lists files removed by update");
  assert.equal(plan.candidate.files.includes(removed), false);
  assert.deepEqual(readFileSync(join(target, removed)), before, "Preview preserves the existing file");
  await f.manager.apply(plan, { approval: true });
  assert.equal(existsSync(join(target, removed)), false);
  assert.equal(f.manager.info("sample", selection).installation.integrity, "intact");
});
