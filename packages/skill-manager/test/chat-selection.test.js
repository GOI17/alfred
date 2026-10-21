import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fixture, install, installPlan, put, receipt, rejectedPlan, selection, tree } from "./helpers.js";

const repo = "https://github.com/example/catalog-source";
const commitA = "c".repeat(40), commitB = "d".repeat(40);
const skillText = (name, body = "Use this fixture safely.") => `---\nname: ${name}\ndescription: A named selection fixture.\n---\n\n${body}\n`;
const selectedPath = "nested/path-unrelated-to-name";
const defaultFiles = () => ({
  [`${selectedPath}/SKILL.md`]: skillText("chosen"),
  [`${selectedPath}/references/guide.txt`]: "Resource from immutable commit.\n",
  "other/SKILL.md": skillText("other"),
  "malformed/SKILL.md": "Not valid frontmatter.\n"
});
function remote(files = defaultFiles()) {
  const snapshots = new Map(), blobs = new Map();
  const transport = {
    head: commitA, requests: [],
    add(commit, entries) {
      snapshots.set(commit, Object.entries(entries).map(([path, content]) => {
        const bytes = Buffer.from(content), sha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
        blobs.set(sha, bytes);
        return { path, sha, size: bytes.length, mode: "100644", type: "blob" };
      }));
    },
    async fetch(input, options) {
      const url = new URL(String(input));
      transport.requests.push(url.href);
      assert.equal(url.origin, "https://api.github.com");
      assert.equal(new Headers(options.headers).has("authorization"), false);
      if (url.pathname.includes("/commits/")) {
        const ref = decodeURIComponent(url.pathname.split("/commits/")[1]);
        return Response.json({ sha: /^[a-f0-9]{40}$/.test(ref) ? ref : transport.head });
      }
      if (url.pathname.includes("/git/trees/")) {
        const commit = url.pathname.split("/git/trees/")[1];
        assert.match(commit, /^[a-f0-9]{40}$/);
        return Response.json({ sha: commit, truncated: false, tree: snapshots.get(commit) });
      }
      if (url.pathname.includes("/git/blobs/")) {
        const sha = url.pathname.split("/git/blobs/")[1], bytes = blobs.get(sha);
        assert.ok(bytes);
        return Response.json({ sha, size: bytes.length, encoding: "base64", content: bytes.toString("base64") });
      }
      throw new Error("Unexpected endpoint");
    }
  };
  transport.add(commitA, files); transport.add(commitB, files);
  return transport;
}
const namedPlan = (f, overrides = {}) => f.manager.plan({ operation: "install", source: repo, name: "chosen", ref: "main", ...selection, ...overrides });

test("--name selects declared metadata at an immutable commit instead of guessing a directory", async (t) => {
  const transport = remote(), f = fixture(t, { fetch: transport.fetch });
  const preview = await namedPlan(f);
  assert.equal(preview.name, "chosen");
  assert.equal(preview.source.skillPath, selectedPath);
  assert.equal(preview.source.resolvedCommit, commitA);
  assert.equal(preview.source.requestedRef, "main");
  assert.deepEqual(preview.candidate.files, ["SKILL.md", "references/guide.txt"]);
  await f.manager.apply(preview, { approval: true });
  assert.equal(receipt(f).installations[0].source.skillPath, selectedPath);
  assert.equal(readFileSync(join(preview.targetPath, "references", "guide.txt"), "utf8"), "Resource from immutable commit.\n");
  const beforeUpdate = transport.requests.length;
  const update = await f.manager.plan({ operation: "update", name: "chosen", ...selection });
  assert.equal(update.status, "unchanged");
  const requests = transport.requests.slice(beforeUpdate);
  const otherMetadataSha = createHash("sha1").update(`blob ${Buffer.byteLength(skillText("other"))}\0`).update(skillText("other")).digest("hex");
  assert.ok(requests.every(url => !url.endsWith(otherMetadataSha)), "Update reuses concrete selected path without scanning other skill metadata");
});

test("ambiguous names expose candidate paths and never install the first match", async (t) => {
  const transport = remote({ ...defaultFiles(), "second/chosen/SKILL.md": skillText("chosen") });
  const f = fixture(t, { fetch: transport.fetch });
  await assert.rejects(() => namedPlan(f), error => error.code === "E_AMBIGUOUS" && error.message.includes(selectedPath) && error.message.includes("second/chosen"));
  assert.deepEqual(readdirSync(f.cwd), []);
  const explicit = await namedPlan(f, { name: undefined, skill: selectedPath });
  assert.equal(explicit.source.skillPath, selectedPath);
});

test("no named match fails clearly without materializing anything", async (t) => {
  const transport = remote(), f = fixture(t, { fetch: transport.fetch });
  await assert.rejects(() => namedPlan(f, { name: "absent" }), { code: "E_NOT_FOUND" });
  assert.deepEqual(readdirSync(f.cwd), []);
});

test("conflicting name/path selectors and a local name selector fail before acquisition", async (t) => {
  const transport = remote(), f = fixture(t, { fetch: transport.fetch });
  await rejectedPlan(() => namedPlan(f, { skill: selectedPath }), /name|skill|exclusive|selector/i);
  await rejectedPlan(() => installPlan(f, { name: "sample" }), /name|local|GitHub|selector/i);
  assert.equal(transport.requests.length, 0);
});

test("named selection refuses an unbounded metadata scan rather than claiming uniqueness", async (t) => {
  const many = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`skills/s${i}/SKILL.md`, skillText(i ? `s${i}` : "chosen")]));
  const transport = remote(many), f = fixture(t, { fetch: transport.fetch });
  await rejectedPlan(() => namedPlan(f), /limit|scan|many|100|large/i);
  assert.deepEqual(readdirSync(f.cwd), []);
  assert.ok(transport.requests.filter(url => url.includes("/git/blobs/")).length <= 100);
});

test("oversized candidate metadata prevents an unverifiable uniqueness claim", async (t) => {
  const transport = remote({ ...defaultFiles(), "huge/SKILL.md": skillText("chosen", "x".repeat(70 * 1024)) });
  const f = fixture(t, { fetch: transport.fetch });
  await rejectedPlan(() => namedPlan(f), /limit|metadata|size|large/i);
  assert.deepEqual(readdirSync(f.cwd), []);
});

test("guarded apply preserves branch tracking and rejects a changed commit with identical bytes", async (t) => {
  const transport = remote(), f = fixture(t, { fetch: transport.fetch });
  const reviewed = await namedPlan(f);
  const guarded = { expectedDigest: reviewed.candidate.installedDigest, expectedCommit: commitA };
  transport.head = commitB;
  await assert.rejects(() => namedPlan(f, guarded), { code: "E_STALE_PLAN" });
  assert.deepEqual(readdirSync(f.cwd), []);
  transport.head = commitA;
  const plan = await namedPlan(f, guarded);
  await f.manager.apply(plan, { approval: true });
  assert.equal(receipt(f).installations[0].source.requestedRef, "main");
  assert.equal(receipt(f).installations[0].source.resolvedCommit, commitA);
});

test("guarded plan also revalidates a branch change during the later apply acquisition", async (t) => {
  const transport = remote(), f = fixture(t, { fetch: transport.fetch });
  const reviewed = await namedPlan(f);
  const plan = await namedPlan(f, { expectedDigest: reviewed.candidate.installedDigest, expectedCommit: commitA });
  transport.head = commitB;
  await assert.rejects(() => f.manager.apply(plan, { approval: true }), { code: "E_STALE_PLAN" });
  assert.equal(existsSync(plan.targetPath), false);
  assert.equal(existsSync(f.lock), false);
});

test("local reviewed digest rejects changed content across fresh manager processes", async (t) => {
  const f = fixture(t);
  const reviewed = await installPlan(f);
  put(join(f.source, "references", "guide.md"), "Changed after chat review.\n");
  const fresh = f.create();
  await assert.rejects(() => fresh.plan({ operation: "install", source: f.source, expectedDigest: reviewed.candidate.installedDigest, ...selection }), { code: "E_STALE_PLAN" });
  assert.deepEqual(readdirSync(f.cwd), []);
});

test("remove guard binds reviewed current digest and never changes a mismatched installation", async (t) => {
  const f = fixture(t);
  const { target } = await install(f);
  const original = tree(target), lockBefore = readFileSync(f.lock);
  await assert.rejects(() => f.manager.plan({ operation: "remove", name: "sample", expectedDigest: `sha256:${"0".repeat(64)}`, ...selection }), { code: "E_STALE_PLAN" });
  assert.deepEqual(tree(target), original);
  assert.deepEqual(readFileSync(f.lock), lockBefore);
  const removal = await f.manager.plan({ operation: "remove", name: "sample", expectedDigest: receipt(f).installations[0].installedDigest, ...selection });
  await f.manager.apply(removal, { approval: true });
  assert.equal(existsSync(target), false);
});

test("malformed review guards fail before any source transport", async (t) => {
  const transport = remote(), f = fixture(t, { fetch: transport.fetch });
  for (const guard of [{ expectedDigest: "bad" }, { expectedDigest: "sha256:abc" }, { expectedCommit: "main" }, { expectedCommit: "a".repeat(39) }]) {
    await rejectedPlan(() => namedPlan(f, guard), /digest|commit|expected|invalid/i);
  }
  assert.equal(transport.requests.length, 0);
});

test("add is the same local lifecycle operation and receipt schema as install", async (t) => {
  const f = fixture(t);
  const plan = await installPlan(f, { operation: "add" });
  assert.equal(plan.operation, "install");
  assert.equal(plan.status, "preview");
  await f.manager.apply(plan, { approval: true });
  assert.equal(receipt(f).schemaVersion, 1);
  assert.equal(receipt(f).installations[0].name, "sample");
  assert.equal(receipt(f).installations[0].source.kind, "local");
});
