import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fixture, put, receipt, rejectedPlan, selection, tree } from "./helpers.js";

const repository = "https://github.com/example/skills";
const commitA = "a".repeat(40), commitB = "b".repeat(40);
const skillPath = "skills/sample";
function gitBlob(bytes) { return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"); }
function files(body = "First source revision.\n") {
  return [
    { path: `${skillPath}/SKILL.md`, bytes: Buffer.from(`---\nname: sample\ndescription: Remote test fixture.\n---\n\n${body}`), mode: "100644" },
    { path: `${skillPath}/references/guide.md`, bytes: Buffer.from("A referenced file.\n"), mode: "100644" },
    { path: `${skillPath}/scripts/check.sh`, bytes: Buffer.from("#!/bin/sh\nexit 0\n"), mode: "100755" },
    { path: "skills/unselected/SKILL.md", bytes: Buffer.from("---\nname: unselected\ndescription: Do not install.\n---\n"), mode: "100644" }
  ];
}
function remote() {
  const snapshots = new Map(), blobs = new Map(), requests = [];
  const result = {
    head: commitA, requests, mutateTree: null, mutateBlob: null,
    add(commit, entries) {
      const rows = entries.map(entry => {
        const sha = gitBlob(entry.bytes);
        blobs.set(sha, entry.bytes);
        return { path: entry.path, type: "blob", mode: entry.mode, size: entry.bytes.length, sha };
      });
      snapshots.set(commit, rows);
    },
    async fetch(input, options = {}) {
      const url = new URL(String(input));
      requests.push(url.href);
      assert.equal(url.origin, "https://api.github.com");
      const headers = new Headers(options.headers);
      assert.equal(headers.has("authorization"), false, "Public source must not search ambient credentials");
      const path = decodeURIComponent(url.pathname);
      if (path.startsWith("/repos/example/skills/commits/")) {
        const ref = path.slice("/repos/example/skills/commits/".length);
        const sha = /^[a-f0-9]{40}$/.test(ref) ? ref : result.head;
        if (!snapshots.has(sha)) return Response.json({ message: "Not Found" }, { status: 404 });
        return Response.json({ sha });
      }
      if (path.startsWith("/repos/example/skills/git/trees/")) {
        const commit = path.slice("/repos/example/skills/git/trees/".length);
        assert.match(commit, /^[a-f0-9]{40}$/, "Tree acquisition is pinned to a full commit");
        assert.equal(url.searchParams.get("recursive"), "1");
        const value = { sha: commit, truncated: false, tree: structuredClone(snapshots.get(commit)) };
        return Response.json(result.mutateTree ? result.mutateTree(value) : value);
      }
      if (path.startsWith("/repos/example/skills/git/blobs/")) {
        const sha = path.slice("/repos/example/skills/git/blobs/".length), bytes = blobs.get(sha);
        assert.ok(bytes, "All blobs belong to an acquired fixture tree");
        const value = { sha, encoding: "base64", size: bytes.length, content: bytes.toString("base64") };
        return Response.json(result.mutateBlob ? result.mutateBlob(value) : value);
      }
      throw new Error(`Unexpected remote request ${url.href}`);
    }
  };
  result.add(commitA, files());
  result.add(commitB, files("Second source revision.\n"));
  return result;
}

function remotePlan(f, options = {}) {
  return f.manager.plan({ operation: "install", source: repository, skill: skillPath, ref: "main", ...selection, ...options });
}

test("GitHub acquisition selects one skill and records an immutable full revision", async (t) => {
  const transport = remote();
  const f = fixture(t, { fetch: transport.fetch });
  const plan = await remotePlan(f);
  assert.equal(plan.status, "preview");
  assert.equal(plan.source.repository, repository);
  assert.equal(plan.source.requestedRef, "main");
  assert.equal(plan.source.resolvedCommit, commitA);
  assert.equal(plan.source.skillPath, skillPath);
  assert.deepEqual(plan.candidate.files.slice().sort(), ["SKILL.md", "references/guide.md", "scripts/check.sh"]);
  await f.manager.apply(plan, { approval: true });
  const entry = receipt(f).installations[0];
  assert.equal(entry.source.resolvedCommit, commitA);
  assert.equal(entry.declaredVersion, null);
  assert.match(entry.installedDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(readFileSync(join(plan.targetPath, "references", "guide.md"), "utf8"), "A referenced file.\n");
  const requestCount = transport.requests.length;
  f.manager.list(); f.manager.info("sample", selection);
  assert.equal(transport.requests.length, requestCount, "Inventory and info never contact source transport");
});

test("branch update follows the saved requested ref and no-op update preserves receipt", async (t) => {
  const transport = remote();
  const f = fixture(t, { fetch: transport.fetch });
  await f.manager.apply(await remotePlan(f), { approval: true });
  const before = readFileSync(f.lock);
  const noop = await f.manager.plan({ operation: "update", name: "sample", ...selection });
  assert.equal(noop.status, "unchanged");
  await f.manager.apply(noop, { approval: true });
  assert.deepEqual(readFileSync(f.lock), before);
  transport.head = commitB;
  const update = await f.manager.plan({ operation: "update", name: "sample", ...selection });
  assert.equal(update.source.resolvedCommit, commitB);
  assert.equal(update.source.requestedRef, "main");
  await f.manager.apply(update, { approval: true });
  assert.equal(receipt(f).installations[0].source.resolvedCommit, commitB);
});

test("a commit-pinned source remains pinned until an explicit new ref is provided", async (t) => {
  const transport = remote();
  const f = fixture(t, { fetch: transport.fetch });
  await f.manager.apply(await remotePlan(f, { ref: commitA }), { approval: true });
  transport.head = commitB;
  const noChange = await f.manager.plan({ operation: "update", name: "sample", ...selection });
  assert.equal(noChange.status, "unchanged");
  assert.equal(receipt(f).installations[0].source.resolvedCommit, commitA);
  const update = await f.manager.plan({ operation: "update", name: "sample", ref: commitB, ...selection });
  assert.equal(update.source.resolvedCommit, commitB);
  await f.manager.apply(update, { approval: true });
  assert.equal(receipt(f).installations[0].source.requestedRef, commitB);
});

test("apply refuses a branch moved after preview rather than installing unreviewed content", async (t) => {
  const transport = remote();
  const f = fixture(t, { fetch: transport.fetch });
  const plan = await remotePlan(f);
  transport.head = commitB;
  await assert.rejects(() => f.manager.apply(plan, { approval: true }), { code: "E_STALE_PLAN" });
  assert.equal(tree(plan.targetPath), null);
});

for (const invalid of ["truncated", "traversal", "absolute", "symlink", "submodule", "device", "oversize", "too-many-files"]) {
  test(`rejects ${invalid} GitHub trees before materialization`, async (t) => {
    const transport = remote();
    transport.mutateTree = value => {
      if (invalid === "truncated") value.truncated = true;
      if (invalid === "traversal") value.tree.push({ ...value.tree[0], path: `${skillPath}/../../escape` });
      if (invalid === "absolute") value.tree.push({ ...value.tree[0], path: "/absolute" });
      if (invalid === "symlink") value.tree[0].mode = "120000";
      if (invalid === "submodule") { value.tree[0].mode = "160000"; value.tree[0].type = "commit"; }
      if (invalid === "device") value.tree[0].mode = "020644";
      if (invalid === "oversize") value.tree[0].size = 6 * 1024 * 1024;
      if (invalid === "too-many-files") value.tree = Array.from({ length: 1002 }, (_, i) => ({ ...value.tree[0], path: `${skillPath}/file-${i}.txt` }));
      return value;
    };
    const f = fixture(t, { fetch: transport.fetch });
    await rejectedPlan(() => remotePlan(f));
    assert.equal(tree(join(f.cwd, ".agents")), null);
  });
}

test("a blob whose bytes disagree with its Git object identity is rejected", async (t) => {
  const transport = remote();
  transport.mutateBlob = value => ({ ...value, content: Buffer.from("Altered response payload").toString("base64") });
  const f = fixture(t, { fetch: transport.fetch });
  await rejectedPlan(() => remotePlan(f), /hash|digest|sha|size|integrity|blob/i);
  assert.equal(tree(join(f.cwd, ".agents")), null);
});

test("private or missing repositories fail without probing ambient credentials", async (t) => {
  let calls = 0;
  const f = fixture(t, { fetch: async () => { calls++; return Response.json({ message: "Not Found" }, { status: 404 }); } });
  await rejectedPlan(() => remotePlan(f), /404|private|not found|access|github/i);
  assert.equal(calls, 1);
  assert.equal(tree(join(f.cwd, ".agents")), null);
});

test("selected repository paths reject traversal and absolute paths", async (t) => {
  const transport = remote();
  const f = fixture(t, { fetch: transport.fetch });
  for (const skill of ["../sample", "/sample", "skills/../sample", "skills\\sample"]) {
    await rejectedPlan(() => remotePlan(f, { skill }), /path|unsafe|invalid|traversal/i);
  }
  assert.equal(transport.requests.length, 0);
});


test("a local edit during apply's remote acquisition survives as a stale-plan rejection", async (t) => {
  const transport = remote();
  let editDuringFetch = false, target;
  const userEdit = "USER EDIT MUST SURVIVE\n";
  const f = fixture(t, { fetch: async (url, options) => {
    if (editDuringFetch && String(url).includes("/commits/")) {
      editDuringFetch = false;
      put(join(target, "SKILL.md"), userEdit);
    }
    return transport.fetch(url, options);
  } });
  const installed = await f.manager.apply(await remotePlan(f), { approval: true });
  target = installed.targetPath;
  transport.head = commitB;
  const plan = await f.manager.plan({ operation: "update", name: "sample", ...selection });
  const lockBefore = readFileSync(f.lock);
  editDuringFetch = true;
  await assert.rejects(() => f.manager.apply(plan, { approval: true }), { code: "E_STALE_PLAN" });
  assert.equal(readFileSync(join(target, "SKILL.md"), "utf8"), userEdit);
  assert.deepEqual(readFileSync(f.lock), lockBefore);
});

test("a changed commit with identical skill content still records the selected revision", async (t) => {
  const transport = remote();
  transport.add(commitB, files());
  const f = fixture(t, { fetch: transport.fetch });
  await f.manager.apply(await remotePlan(f), { approval: true });
  const digest = receipt(f).installations[0].installedDigest;
  transport.head = commitB;
  const plan = await f.manager.plan({ operation: "update", name: "sample", ...selection });
  assert.equal(plan.status, "preview");
  assert.equal(plan.candidate.installedDigest, digest);
  assert.equal(plan.source.resolvedCommit, commitB);
  await f.manager.apply(plan, { approval: true });
  assert.equal(receipt(f).installations[0].source.resolvedCommit, commitB);
});
