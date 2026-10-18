import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { buildRuntime, createTar, sha256, writeAssetAtomic } from "./build-runtime.mjs";
import { renderFormula } from "./generate-homebrew-formula.mjs";
import { inspectRuntime } from "./runtime-archive.mjs";
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
  put(join(temp, "package-lock.json"), readFileSync(join(temp, "deps/package-lock.json"), "utf8"));
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
  assert.match(first.formula.toString(), /alfred\/releases\/download\/v1\.2\.3\/alfred-1\.2\.3-runtime\.tar\.gz/);
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

test("runtime dependency closure supports nested locked packages and rejects missing production packages", (t) => {
  const f = fixture(t);
  const lockPath = join(f.temp, "deps/package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath));
  lock.packages["node_modules/example/node_modules/nested"] = { version: "2.0.0", resolved: "https://registry.npmjs.org/nested/-/nested-2.0.0.tgz", integrity: "sha512-fixture" };
  f.put(lockPath, lock);
  f.put(join(f.temp, "package-lock.json"), lock);
  assert.throws(f.build, /Missing locked production dependency/);
  f.put(join(f.dependencies, "example/node_modules/nested/package.json"), { name: "nested", version: "2.0.0" });
  f.put(join(f.dependencies, "example/node_modules/nested/index.js"), "module.exports = 2;\n");
  const { archive, manifestBytes } = f.candidate();
  assert.ok(inspectRuntime(archive, manifestBytes).files.has("node_modules/example/node_modules/nested/index.js"));
  lock.packages["node_modules/example/node_modules/nested"].dev = true;
  f.put(lockPath, lock);
  f.put(join(f.temp, "package-lock.json"), lock);
  assert.throws(f.build, /outside production lock/);
});

test("runtime dependency policy rejects private resolutions, symlinked locks and nested symlink escapes", (t) => {
  const f = fixture(t);
  const lockPath = join(f.temp, "deps/package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath));
  lock.packages["node_modules/example"].resolved = "git+https://github.com/private/secret.git";
  f.put(lockPath, lock);
  f.put(join(f.temp, "package-lock.json"), lock);
  assert.throws(f.build, /outside production lock/);
  lock.packages["node_modules/example"].resolved = "https://registry.npmjs.org/example/-/example-1.0.0.tgz";
  f.put(join(f.temp, "outside-lock.json"), lock);
  rmSync(lockPath);
  symlinkSync(join(f.temp, "outside-lock.json"), lockPath);
  assert.throws(f.build, /lock must not be a symlink/);
  rmSync(lockPath);
  f.put(lockPath, lock);
  f.put(join(f.temp, "package-lock.json"), lock);
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

test("runtime builder rejects symlinked nested node_modules before following its directory", (t) => {
  const f = fixture(t);
  f.put(join(f.temp, "outside-modules/secret.txt"), "Outside dependency boundary");
  symlinkSync(join(f.temp, "outside-modules"), join(f.dependencies, "example/node_modules"));
  assert.throws(f.build, /symlink/i);
});

test("runtime permits public PEM parser delimiters without permitting private-key bodies", (t) => {
  const f = fixture(t);
  f.put(join(f.root, "app.mjs"), "export const delimiter = '-----BEGIN PRIVATE KEY-----';\n");
  const { archive, manifestBytes } = f.candidate();
  assert.ok(inspectRuntime(archive, manifestBytes).files.has("app.mjs"));
});


test("runtime rejects a staging lock changed together with transitive dependency bytes", t => {
  const f = fixture(t);
  const file = join(f.temp, "deps/package-lock.json");
  const lock = JSON.parse(readFileSync(file));
  lock.packages["node_modules/example"].version = "2.0.0";
  f.put(file, lock);
  f.put(join(f.dependencies, "example/package.json"), { name: "example", version: "2.0.0" });
  assert.throws(f.build, /differs from reviewed lock/);
});

test("asset atomic writes do not follow planted predictable temporary symlinks", t => {
  const f = fixture(t), target = join(f.temp, "outside.txt"), output = join(f.temp, "asset.txt");
  f.put(target, "preserve");
  symlinkSync(target, `${output}.${process.pid}.tmp`);
  writeAssetAtomic(output, Buffer.from("new artifact"));
  assert.equal(readFileSync(target, "utf8"), "preserve");
  assert.equal(readFileSync(output, "utf8"), "new artifact");
});

test("checksums bind archive, inventory and generated public formula", t => {
  const f = fixture(t), candidate = f.candidate();
  const name = `alfred-${candidate.result.version}-runtime.tar.gz`;
  assert.equal(readFileSync(join(f.output, "SHA256SUMS"), "utf8"),
    `${sha256(candidate.archive)}  ${name}\n${sha256(candidate.manifestBytes)}  runtime-manifest.json\n${sha256(candidate.formula)}  alfred.rb\n`);
});
