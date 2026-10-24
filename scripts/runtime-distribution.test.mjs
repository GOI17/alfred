import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { downloadSmokeArchive } from "./runtime-smoke-download.mjs";
import { buildRuntime, createTar, sha256, writeAssetAtomic } from "./build-runtime.mjs";
import { nativeDependencyIdentity } from "./workspace-native-artifacts.mjs";
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

function nativeFixture(t) {
  const f = fixture(t);
  const lock = JSON.parse(readFileSync(join(f.temp, 'deps/package-lock.json')));
  for (const [name, version] of [['node-pty', '1.1.0'], ['node-addon-api', '7.1.1']]) {
    lock.packages[`node_modules/${name}`] = { version, resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, integrity: `sha512-${name}` };
    f.put(join(f.dependencies, name, 'package.json'), { name, version });
  }
  const lockBytes = Buffer.from(JSON.stringify(lock));
  f.put(join(f.temp, 'deps/package-lock.json'), lock);
  f.put(join(f.temp, 'package-lock.json'), lock);
  const policy = JSON.parse(readFileSync(f.allowlist));
  policy.dependencies['node-pty'] = '1.1.0';
  policy.workspaceNative = { targets: ['darwin-arm64','darwin-x64','linux-arm64','linux-x64'], version: '1.1.0' };
  f.put(f.allowlist, policy);
  f.options.workspaceNative = join(f.temp, 'native');
  const binary = target => {
    const bytes = Buffer.alloc(64);
    if (target.startsWith('darwin')) { bytes.writeUInt32LE(0xfeedfacf,0); bytes.writeUInt32LE(target.endsWith('arm64') ? 0x100000c : 0x1000007,4); }
    else { bytes.set([0x7f,0x45,0x4c,0x46,2,1]); bytes.writeUInt16LE(target.endsWith('arm64') ? 183 : 62,18); }
    return bytes;
  };
  for (const target of policy.workspaceNative.targets) {
    const dir = target.startsWith('darwin') ? join(f.dependencies,'node-pty/prebuilds',target) : join(f.options.workspaceNative,target);
    mkdirSync(dir,{recursive:true});
    writeFileSync(join(dir,'pty.node'),binary(target));
    if (target.startsWith('darwin')) writeFileSync(join(dir,'spawn-helper'),binary(target));
    else f.put(join(dir,'manifest.json'), { schema:'alfred.workspace.native/v1', target, source_revision:f.options.sourceRevision,
      ...nativeDependencyIdentity(lockBytes), builder_sha256:sha256(readFileSync(new URL('./build-workspace-native.mjs',import.meta.url))), sha256:sha256(binary(target)), smoke:'pty-spawn-output-exit' });
  }
  return f;
}

test('Workspace distribution preserves real executable modes and requires all four native targets', t => {
  const f = nativeFixture(t);
  f.put(join(f.dependencies, 'example/package.json'), { name:'example', version:'1.0.0', bin:{example:'./index.js'} });
  f.put(join(f.dependencies, 'node-pty/third_party/conpty/version/win10-x64/OpenConsole.exe'), 'unneeded Windows executable');
  const {archive,manifestBytes} = f.candidate();
  const {files} = inspectRuntime(archive,manifestBytes);
  assert.ok(!files.has('node_modules/node-pty/third_party/conpty/version/win10-x64/OpenConsole.exe'));
  for (const target of ['darwin-arm64','darwin-x64','linux-arm64','linux-x64']) assert.equal(files.get(`node_modules/node-pty/prebuilds/${target}/pty.node`).mode,0o644);
  for (const target of ['darwin-arm64','darwin-x64']) assert.equal(files.get(`node_modules/node-pty/prebuilds/${target}/spawn-helper`).mode,0o755);
  assert.equal(files.get('node_modules/example/index.js').mode,0o755);
  assert.ok(files.has('packages/workspace/native-manifest.json'));
  rmSync(join(f.dependencies,'node-pty/prebuilds/darwin-x64/spawn-helper'));
  assert.throws(f.build,/Missing vendored Workspace native/);
});

test('Workspace native provenance rejects stale lock, revision, wrong architecture, tampering and symlinks', t => {
  const f = nativeFixture(t);
  const dir = join(f.options.workspaceNative,'linux-arm64'), path=join(dir,'manifest.json');
  const original = JSON.parse(readFileSync(path));
  for (const patch of [ {source_revision:'c'.repeat(40)}, {dependencies_lock_sha256:'0'.repeat(64)}, {sha256:'0'.repeat(64)}, {builder_sha256:'0'.repeat(64)}, {target:'linux-x64'}, {smoke:'help-only'} ]) {
    f.put(path,{...original,...patch}); assert.throws(f.build,/native provenance mismatch/);
  }
  f.put(path,original);
  writeFileSync(join(dir,'pty.node'),readFileSync(join(f.options.workspaceNative,'linux-x64/pty.node')));
  f.put(path,{...original,sha256:sha256(readFileSync(join(dir,'pty.node')))});
  assert.throws(f.build,/Invalid Workspace PTY binary/);
  rmSync(join(dir,'pty.node'));
  symlinkSync(join(f.options.workspaceNative,'linux-x64/pty.node'),join(dir,'pty.node'));
  assert.throws(f.build,/Invalid native artifact input/);
});


test("runtime smoke verifies a slow complete archive body and still rejects stalls and corruption", async t => {
  const payload = Buffer.from("complete runtime archive fixture");
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/gzip" });
    if (request.url === "/stall") { response.write("partial"); return; }
    if (request.url === "/corrupt") { response.end("changed bytes"); return; }
    response.write(payload.subarray(0, 4));
    // Reproduce the old five-second body abort on a slow/loaded Intel runner.
    const timer = setTimeout(() => response.end(payload.subarray(4)), 5500);
    response.once("close", () => clearTimeout(timer));
  });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  t.after(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await downloadSmokeArchive(`${origin}/slow`, sha256(payload)), payload);
  await assert.rejects(downloadSmokeArchive(`${origin}/stall`, sha256(payload), 20), /archive transfer failed \(20ms deadline\)/);
  await assert.rejects(downloadSmokeArchive(`${origin}/corrupt`, sha256(payload)), /archive transfer checksum/);
});
