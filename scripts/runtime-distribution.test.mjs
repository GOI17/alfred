import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { buildRuntime, createTar, sha256 } from "./build-runtime.mjs";
import { renderFormula } from "./generate-homebrew-formula.mjs";
import { inspectRuntime } from "./runtime-archive.mjs";
import { downloadAnonymous, publishRuntime, TARGET, SOURCE } from "./publish-homebrew-runtime.mjs";
import { gunzipSync, gzipSync } from "node:zlib";

function fixture(t) {
  const temp = mkdtempSync(join(tmpdir(), "alfred-runtime-fixture-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const root = join(temp, "source"), dependencies = join(temp, "deps", "node_modules"), output = join(temp, "output"), allowlist = join(temp, "allowlist.json");
  const put = (path, value) => { mkdirSync(dirname(path), { recursive: true }); const temporary = `${path}.fixture.tmp`; writeFileSync(temporary, typeof value === "string" ? value : JSON.stringify(value)); renameSync(temporary, path); };
  put(join(root, "package.json"), { name: "private-source", version: "1.2.3", scripts: { secretInternalCommand: "not-distributed" } });
  put(join(root, "app.mjs"), "export const runtime = true;\n");
  put(join(root, ".ai/execution/internal.md"), "Never include internal specs");
  put(join(dependencies, "example/package.json"), { name: "example", version: "1.0.0", main: "index.js" });
  put(join(dependencies, "example/index.js"), "module.exports = {};\n");
  put(join(dependencies, "example/LICENSE"), "Fixture dependency license\n");
  put(join(temp, "deps/package-lock.json"), { lockfileVersion: 3, packages: { "node_modules/example": { version: "1.0.0", resolved: "https://registry.npmjs.org/example/-/example-1.0.0.tgz", integrity: "sha512-fixture" } } });
  put(allowlist, { schema: "alfred.runtime.allowlist/v1", includes: ["app.mjs"], packageMetadata: [], dependencies: { example: "1.0.0" }, workspaceModules: {} });
  const options = { root, dependencies, output, allowlist, sourceRevision: "a".repeat(40), builderRevision: "b".repeat(40) };
  const build = () => buildRuntime(options);
  const candidate = () => {
    const result = build();
    return { result, archive: readFileSync(result.archive), manifestBytes: readFileSync(join(output, "runtime-manifest.json")), formula: readFileSync(join(output, "alfred.rb")), provenanceSources: { "scripts/build-runtime.mjs": readFileSync(new URL("./build-runtime.mjs", import.meta.url)), "scripts/generate-homebrew-formula.mjs": readFileSync(new URL("./generate-homebrew-formula.mjs", import.meta.url)), "packaging/runtime/allowlist.json": readFileSync(allowlist), "packaging/runtime/package-lock.json": readFileSync(join(temp, "deps/package-lock.json")) } };
  };
  return { temp, root, dependencies, output, allowlist, put, options, build, candidate };
}

test("runtime archive is deterministic, inventoried and excludes source metadata", (t) => {
  const f = fixture(t), first = f.candidate(), second = f.candidate();
  assert.deepEqual(first.archive, second.archive);
  const { manifest, files } = inspectRuntime(first.archive, first.manifestBytes);
  assert.equal(manifest.provenance.source_revision, "a".repeat(40));
  assert.match(manifest.provenance.builder_sha256, /^[a-f0-9]{64}$/);
  assert.ok(files.has("node_modules/example/LICENSE"));
  assert.ok(!files.has(".ai/execution/internal.md"));
  assert.ok(!files.get("package.json").bytes.toString().includes("secretInternalCommand"));
  assert.match(first.formula.toString(), /homebrew-alfred\/releases\/download\/v1\.2\.3\/alfred-1\.2\.3-runtime\.tar\.gz/);
  assert.ok(first.formula.toString().includes(first.result.sha256));
});

test("runtime builder rejects missing input, traversal, output overlap and credentials", (t) => {
  const f = fixture(t);
  f.put(f.allowlist, { schema: "alfred.runtime.allowlist/v1", includes: ["missing.mjs"] });
  assert.throws(f.build, /Missing required runtime input/);
  f.put(f.allowlist, { schema: "alfred.runtime.allowlist/v1", includes: ["../outside"] });
  assert.throws(f.build, /Unsafe runtime path/);
  f.put(f.allowlist, { schema: "alfred.runtime.allowlist/v1", includes: ["app.mjs"] });
  assert.throws(() => f.build() && buildRuntime({ ...f.options, output: join(f.root, "dist") }), /overlap/);
  f.put(join(f.root, "app.mjs"), "-----BEGIN PRIVATE KEY-----\n" + "A".repeat(64) + "\n-----END PRIVATE KEY-----");
  assert.throws(f.build, /Possible credential/);
});

test("runtime builder rejects symlinked input ancestors and metadata", (t) => {
  const f = fixture(t);
  f.put(join(f.temp, "outside/widget/index.js"), "Private fixture outside allowlist root");
  symlinkSync(join(f.temp, "outside"), join(f.root, "packages"));
  f.put(f.allowlist, { schema: "alfred.runtime.allowlist/v1", includes: ["packages/widget/*.js"] });
  assert.throws(f.build, /Symlink/);
  f.put(f.allowlist, { schema: "alfred.runtime.allowlist/v1", includes: ["app.mjs"], packageMetadata: ["widget"] });
  assert.throws(f.build, /Symlink/);
});

test("runtime builder rejects arbitrary dependency files and packages outside production lock", (t) => {
  const f = fixture(t);
  f.put(join(f.dependencies, "unexpected-private-note.txt"), "Must never ship");
  assert.throws(f.build, /Unexpected dependency entry/);
  rmSync(join(f.dependencies, "unexpected-private-note.txt"));
  f.put(join(f.dependencies, "unreviewed/package.json"), { name: "unreviewed", version: "1.0.0" });
  assert.throws(f.build, /outside production lock/);
  rmSync(join(f.dependencies, "unreviewed"), { recursive: true });
  f.put(join(f.dependencies, "example/package.json"), { name: "example", version: "2.0.0" });
  assert.throws(f.build, /version mismatch/);
});

test("archive reader rejects tampering and manifest omissions", (t) => {
  const { archive, manifestBytes } = fixture(t).candidate();
  const { files } = inspectRuntime(archive, manifestBytes);
  files.get("app.mjs").bytes = Buffer.from("unreviewed bytes");
  assert.throws(() => inspectRuntime(gzipSync(createTar(files)), manifestBytes), /mismatch/);
  files.set("extra.mjs", { bytes: Buffer.from("unreviewed extra file"), mode: 0o644 });
  assert.throws(() => inspectRuntime(gzipSync(createTar(files)), manifestBytes), /inventory every file/);
});

function publicationFixture(t, { exploratory = false } = {}) {
  const source = fixture(t);
  source.options.exploratory = exploratory;
  const candidate = source.candidate(), calls = [];
  let existingRelease = null, anonymous = candidate.archive, sourcePrivate = true, targetPrivate = false;
  const api = async (method, path, body, options) => {
    calls.push({ method, path, body });
    if (method === "GET" && path === `/repos/${TARGET}`) return { full_name: TARGET, private: targetPrivate, default_branch: "main" };
    if (method === "GET" && path.includes("/releases/tags/")) return existingRelease;
    if (method === "POST" && path.endsWith("/releases")) return { ...body, id: 1, assets: [] };
    if (method === "GET" && path.includes("/releases/assets/")) return Buffer.from("different bytes");
    if (method === "GET" && path.includes("/contents/")) return null;
    return {};
  };
  const sourceApi = async (method, path) => {
    calls.push({ method, path });
    if (path === `/repos/${SOURCE}`) return { full_name: SOURCE, private: sourcePrivate };
    if (path.includes("/commits/")) return { sha: path.split("/").at(-1) };
    const sourcePath = path.split("/contents/")[1]?.split("?")[0];
    if (candidate.provenanceSources[sourcePath]) return { content: candidate.provenanceSources[sourcePath].toString("base64") };
    return { content: Buffer.from(JSON.stringify({ version: "1.2.3" })).toString("base64") };
  };
  const options = { ...candidate, target: TARGET, expectedSha256: candidate.result.sha256, approvedSha256: candidate.result.sha256, expectedFormulaSha256: sha256(candidate.formula), approvedFormulaSha256: sha256(candidate.formula), api, sourceApi, anonymousDownload: async (url) => { calls.push({ method: "ANONYMOUS", path: url }); return anonymous; } };
  return { options, calls, setRelease: (release) => { existingRelease = release; }, setAnonymous: (bytes) => { anonymous = bytes; }, setPrivate: (source, target) => { sourcePrivate = source; targetPrivate = target; } };
}

test("publisher rejects archive/formula approval mismatch or tampering before API calls", async (t) => {
  const f = publicationFixture(t);
  await assert.rejects(publishRuntime({ ...f.options, approvedSha256: "b".repeat(64) }), /approval checksum/);
  await assert.rejects(publishRuntime({ ...f.options, archive: Buffer.concat([f.options.archive, Buffer.from("tampered")]) }), /Archive bytes/);
  await assert.rejects(publishRuntime({ ...f.options, manifestBytes: Buffer.from("{}") }), /External manifest/);
  await assert.rejects(publishRuntime({ ...f.options, approvedFormulaSha256: "b".repeat(64) }), /formula approval/);
  await assert.rejects(publishRuntime({ ...f.options, formula: Buffer.from("unreviewed") }), /Formula bytes/);
  assert.equal(f.calls.length, 0);
});

test("publisher requires private source and public destination without changing visibility", async (t) => {
  const f = publicationFixture(t);
  f.setPrivate(true, true);
  await assert.rejects(publishRuntime(f.options), /already be public/);
  f.setPrivate(false, false);
  await assert.rejects(publishRuntime(f.options), /remain private/);
  assert.ok(f.calls.every((call) => call.method === "GET"));
});

test("publisher uploads assets, verifies anonymous bytes, then activates exact approved formula", async (t) => {
  const f = publicationFixture(t);
  await publishRuntime(f.options);
  const anonymous = f.calls.findIndex((call) => call.method === "ANONYMOUS");
  const formula = f.calls.findIndex((call) => call.method === "PUT");
  assert.ok(anonymous > f.calls.findIndex((call) => call.method === "PATCH"));
  assert.ok(formula > anonymous);
  assert.deepEqual(Buffer.from(f.calls[formula].body.content, "base64"), f.options.formula);
});

test("publisher never activates formula after anonymous checksum mismatch", async (t) => {
  const f = publicationFixture(t);
  f.setAnonymous(Buffer.from("wrong download"));
  await assert.rejects(publishRuntime(f.options), /Anonymous release download/);
  assert.ok(!f.calls.some((call) => call.method === "PUT"));
});

test("publisher rejects existing release with unrelated assets before writes", async (t) => {
  const f = publicationFixture(t);
  f.setRelease({ id: 1, draft: true, prerelease: false, tag_name: "v1.2.3", name: "Alfred 1.2.3", target_commitish: "main", body: "Reviewed Alfred runtime. Includes readable JavaScript, shell, HTML, SQL, agent/skill instructions, and production dependencies. The private source repository and its history are not published.", assets: [{ id: 3, name: "private-source.zip" }] });
  await assert.rejects(publishRuntime(f.options), /Unexpected release assets/);
  assert.ok(f.calls.every((call) => call.method === "GET"));
});

test("publisher rejects replacing same-version bytes", async (t) => {
  const f = publicationFixture(t);
  f.setRelease({ id: 1, draft: false, prerelease: false, tag_name: "v1.2.3", name: "Alfred 1.2.3", target_commitish: "main", body: "Reviewed Alfred runtime. Includes readable JavaScript, shell, HTML, SQL, agent/skill instructions, and production dependencies. The private source repository and its history are not published.", assets: [{ id: 3, name: "alfred-1.2.3-runtime.tar.gz" }] });
  await assert.rejects(publishRuntime(f.options), /Refusing different bytes/);
  assert.ok(f.calls.every((call) => call.method === "GET"));
});

test("publisher download helper retrieves fixture over anonymous local HTTP with no credentials", async (t) => {
  const { archive, manifestBytes } = fixture(t).candidate();
  // Exercise the production downloader with credential-shaped environment values.
  const before = Object.fromEntries(["GH_TOKEN", "GITHUB_TOKEN", "DISTRIBUTION_TOKEN", "SOURCE_READ_TOKEN"].map((key) => [key, process.env[key]]));
  for (const key of Object.keys(before)) process.env[key] = "synthetic-token-not-a-real-credential";
  t.after(() => { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.cookie, undefined);
    response.end(archive);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  try {
    const downloaded = await downloadAnonymous(`http://127.0.0.1:${server.address().port}/runtime.tar.gz`);
    assert.equal(sha256(downloaded), sha256(archive));
    assert.equal(inspectRuntime(downloaded, manifestBytes).manifest.version, "1.2.3");
  } finally { await new Promise((done) => server.close(done)); }
});


test("runtime dependency closure supports nested locked packages and rejects missing production packages", (t) => {
  const f = fixture(t);
  const lockPath = join(f.temp, "deps/package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath));
  lock.packages["node_modules/example/node_modules/nested"] = { version: "2.0.0", resolved: "https://registry.npmjs.org/nested/-/nested-2.0.0.tgz", integrity: "sha512-fixture" };
  f.put(lockPath, lock);
  assert.throws(f.build, /Missing locked production dependency/);
  f.put(join(f.dependencies, "example/node_modules/nested/package.json"), { name: "nested", version: "2.0.0" });
  f.put(join(f.dependencies, "example/node_modules/nested/index.js"), "module.exports = 2;\n");
  const { archive, manifestBytes } = f.candidate();
  assert.ok(inspectRuntime(archive, manifestBytes).files.has("node_modules/example/node_modules/nested/index.js"));
  lock.packages["node_modules/example/node_modules/nested"].dev = true;
  f.put(lockPath, lock);
  assert.throws(f.build, /outside production lock/);
});

test("runtime dependency policy rejects private resolutions, symlinked locks and nested symlink escapes", (t) => {
  const f = fixture(t);
  const lockPath = join(f.temp, "deps/package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath));
  lock.packages["node_modules/example"].resolved = "git+https://github.com/private/secret.git";
  f.put(lockPath, lock);
  assert.throws(f.build, /outside production lock/);
  lock.packages["node_modules/example"].resolved = "https://registry.npmjs.org/example/-/example-1.0.0.tgz";
  f.put(join(f.temp, "outside-lock.json"), lock);
  rmSync(lockPath);
  symlinkSync(join(f.temp, "outside-lock.json"), lockPath);
  assert.throws(f.build, /lock must not be a symlink/);
  rmSync(lockPath);
  f.put(lockPath, lock);
  f.put(join(f.temp, "outside-package/index.js"), "module.exports = 'private';\n");
  symlinkSync(join(f.temp, "outside-package"), join(f.dependencies, "example/nested"));
  assert.throws(f.build, /Dependency symlink/);
});

test("archive reader rejects forged headers, duplicate entries and hidden trailing data", (t) => {
  const { archive, manifestBytes } = fixture(t).candidate();
  const original = gunzipSync(archive);
  const badChecksum = Buffer.from(original);
  badChecksum[0] ^= 1;
  assert.throws(() => inspectRuntime(gzipSync(badChecksum), manifestBytes), /tar checksum/);
  const symlink = Buffer.from(original);
  symlink[156] = "2".charCodeAt(0);
  symlink.fill(32, 148, 156);
  symlink.write(symlink.subarray(0, 512).reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ", 148, 8);
  assert.throws(() => inspectRuntime(gzipSync(symlink), manifestBytes), /Only regular files/);
  const size = parseInt(original.subarray(124, 136).toString(), 8);
  const entry = original.subarray(0, 512 + Math.ceil(size / 512) * 512);
  assert.throws(() => inspectRuntime(gzipSync(Buffer.concat([entry, original])), manifestBytes), /Duplicate archive file/);
  assert.throws(() => inspectRuntime(gzipSync(Buffer.concat([original, Buffer.from("hidden bytes")])), manifestBytes), /trailing archive data/);
});

test("publisher rejects unreviewed destination and independently approved invalid formula before API access", async (t) => {
  const f = publicationFixture(t);
  await assert.rejects(publishRuntime({ ...f.options, target: "GOI17/other" }), /Destination/);
  const altered = Buffer.from(f.options.formula.toString().replace("homebrew-alfred/releases/download", "alfred/releases/download"));
  assert.notDeepEqual(altered, f.options.formula);
  await assert.rejects(publishRuntime({ ...f.options, formula: altered, expectedFormulaSha256: sha256(altered), approvedFormulaSha256: sha256(altered) }), /URL\/version\/hash contract/);
  assert.equal(f.calls.length, 0);
});

test("publisher checks source revision and package version before target mutation", async (t) => {
  const f = publicationFixture(t), sourceApi = f.options.sourceApi;
  await assert.rejects(publishRuntime({ ...f.options, sourceApi: async (...args) => args[1].includes("/commits/") ? { sha: "c".repeat(40) } : sourceApi(...args) }), /Source revision/);
  await assert.rejects(publishRuntime({ ...f.options, sourceApi: async (...args) => args[1].includes("/contents/package.json") ? { content: Buffer.from('{"version":"9.9.9"}').toString("base64") } : sourceApi(...args) }), /Source package version/);
  assert.ok(f.calls.every((call) => call.method === "GET"));
});

test("publisher retries matching complete release without replacing assets or formula", async (t) => {
  const f = publicationFixture(t);
  const payloads = [f.options.archive, f.options.manifestBytes, Buffer.from(`${f.options.expectedSha256}  alfred-1.2.3-runtime.tar.gz\n`)];
  const names = ["alfred-1.2.3-runtime.tar.gz", "runtime-manifest.json", "alfred-1.2.3-runtime.tar.gz.sha256"];
  f.setRelease({ id: 1, draft: false, prerelease: false, tag_name: "v1.2.3", name: "Alfred 1.2.3", target_commitish: "main", body: "Reviewed Alfred runtime. Includes readable JavaScript, shell, HTML, SQL, agent/skill instructions, and production dependencies. The private source repository and its history are not published.", assets: names.map((name, id) => ({ name, id })) });
  const api = f.options.api;
  await publishRuntime({ ...f.options, api: async (method, path, ...rest) => {
    if (path.includes("/releases/assets/")) { f.calls.push({ method, path }); return payloads[Number(path.split("/").at(-1))]; }
    if (path.includes("/contents/Formula/alfred.rb")) { f.calls.push({ method, path }); return { content: f.options.formula.toString("base64"), sha: "existing-blob" }; }
    return api(method, path, ...rest);
  } });
  assert.ok(f.calls.every((call) => ["GET", "ANONYMOUS"].includes(call.method)));
  assert.equal(f.calls.filter((call) => call.method === "ANONYMOUS").length, 1);
});


test("publisher binds every packaging provenance hash to the exact builder revision", async (t) => {
  for (const path of ["scripts/build-runtime.mjs", "scripts/generate-homebrew-formula.mjs", "packaging/runtime/allowlist.json", "packaging/runtime/package-lock.json"]) {
    const f = publicationFixture(t), sourceApi = f.options.sourceApi;
    await assert.rejects(publishRuntime({ ...f.options, sourceApi: async (...args) => {
      if (args[1].includes(`/contents/${path}?`)) {
        assert.ok(args[1].endsWith(`ref=${"b".repeat(40)}`), "Packaging metadata must use builder revision, independently of source revision");
        return { content: Buffer.from("unreviewed packaging bytes").toString("base64") };
      }
      return sourceApi(...args);
    } }), /hash|provenance|differs|checksum/i, path);
    assert.ok(f.calls.every((call) => call.method === "GET"));
  }
});

test("publisher blocks downgrade and conflicting public version before release writes", async (t) => {
  for (const existing of [
    renderFormula({ source: "release", version: "1.2.4", sha256: "c".repeat(64) }),
    renderFormula({ source: "release", version: "1.2.3", sha256: "c".repeat(64) })
  ]) {
    const f = publicationFixture(t), api = f.options.api;
    await assert.rejects(publishRuntime({ ...f.options, api: async (method, path, ...rest) => {
      if (method === "GET" && path.includes("/contents/Formula/alfred.rb")) {
        f.calls.push({ method, path });
        return { content: Buffer.from(existing).toString("base64"), sha: "existing-blob" };
      }
      return api(method, path, ...rest);
    } }), /downgrade|newer|different|conflict|same.version/i);
    assert.ok(f.calls.every((call) => call.method === "GET"));
  }
});

test("publisher permits migration from same-version private Git to approved public runtime", async (t) => {
  const f = publicationFixture(t), api = f.options.api;
  const legacy = renderFormula({ source: "git", version: "1.2.3", revision: "a".repeat(40) });
  await publishRuntime({ ...f.options, api: async (method, path, ...rest) => {
    if (method === "GET" && path.includes("/contents/Formula/alfred.rb")) {
      f.calls.push({ method, path });
      return { content: Buffer.from(legacy).toString("base64"), sha: "legacy-blob" };
    }
    return api(method, path, ...rest);
  } });
  const mutation = f.calls.find((call) => call.method === "PUT");
  assert.ok(mutation);
  assert.equal(mutation.body.sha, "legacy-blob");
  assert.deepEqual(Buffer.from(mutation.body.content, "base64"), f.options.formula);
});


test("runtime builder rejects symlinked nested node_modules before following its directory", (t) => {
  const f = fixture(t);
  f.put(join(f.temp, "outside-modules/secret.txt"), "Outside dependency boundary");
  symlinkSync(join(f.temp, "outside-modules"), join(f.dependencies, "example/node_modules"));
  assert.throws(f.build, /symlink/i);
});

test("publisher stops before activation when an asset upload fails", async (t) => {
  const f = publicationFixture(t), api = f.options.api;
  await assert.rejects(publishRuntime({ ...f.options, api: async (method, path, ...rest) => {
    if (method === "POST" && path.includes("/assets?")) {
      f.calls.push({ method, path });
      throw new Error("simulated upload failure");
    }
    return api(method, path, ...rest);
  } }), /simulated upload failure/);
  assert.ok(f.calls.some((call) => call.method === "POST"));
  assert.ok(!f.calls.some((call) => ["PATCH", "ANONYMOUS", "PUT"].includes(call.method)));
});


test("publisher refuses exploratory working-tree archives even with matching approval hashes", async (t) => {
  const f = publicationFixture(t, { exploratory: true });
  await assert.rejects(publishRuntime(f.options), /Exploratory working-tree archives/);
  assert.equal(f.calls.length, 0);
});

test("runtime permits public PEM parser delimiters without permitting private-key bodies", (t) => {
  const f = fixture(t);
  f.put(join(f.root, "app.mjs"), "export const delimiter = '-----BEGIN PRIVATE KEY-----';\n");
  const { archive, manifestBytes } = f.candidate();
  assert.ok(inspectRuntime(archive, manifestBytes).files.has("app.mjs"));
});
