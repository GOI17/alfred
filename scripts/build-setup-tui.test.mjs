import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { setupBuildPlan, setupTargets, verifySetupBuildInfo } from "./build-setup-tui.mjs";
import { assertSetupBinary, buildRuntime, sha256 } from "./build-runtime.mjs";
import { inspectRuntime } from "./runtime-archive.mjs";

function binary(target) {
  const bytes = Buffer.alloc(64);
  if (target.startsWith("darwin")) {
    bytes.writeUInt32LE(0xfeedfacf, 0);
    bytes.writeUInt32LE(target.endsWith("arm64") ? 0x100000c : 0x1000007, 4);
  } else {
    bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
    bytes.writeUInt16LE(target.endsWith("arm64") ? 183 : 62, 18);
  }
  return bytes;
}
function fixture(t) {
  const temp = mkdtempSync(join(tmpdir(), "alfred-setup-packaging-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const root = join(temp, "source"), dependencies = join(temp, "deps/node_modules"), output = join(temp, "output"), allowlist = join(temp, "allowlist.json");
  const put = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)); };
  put(join(root, "package.json"), { version: "1.2.3" });
  put(join(root, "app.mjs"), "export {};\n");
  mkdirSync(dependencies, { recursive: true });
  const lock = { lockfileVersion: 3, packages: {} };
  put(join(temp, "deps/package-lock.json"), lock); put(join(temp, "package-lock.json"), lock);
  put(allowlist, { schema: "alfred.runtime.allowlist/v1", includes: ["app.mjs"], setupTui: { targets: setupTargets, directory: "packages/setup-tui/dist" } });
  const binaries = {};
  for (const target of setupTargets) {
    const bytes = binary(target), file = `alfred-setup-${target}`;
    put(join(root, "packages/setup-tui/dist", file), bytes);
    binaries[target] = { file, sha256: sha256(bytes) };
  }
  const manifestPath = join(root, "packages/setup-tui/dist/manifest.json");
  put(manifestPath, { schema: "alfred.setup.binaries/v1", binaries });
  const build = () => buildRuntime({ root, dependencies, output, allowlist, sourceRevision: "a".repeat(40), builderRevision: "b".repeat(40) });
  return { root, output, manifestPath, binaries, put, build };
}
test("setup builds all supported targets offline with reproducible compiler flags", () => {
  const plan = setupBuildPlan("/source with spaces", "/output with spaces", { GOTOOLCHAIN: "auto", CGO_ENABLED: "1", GOFLAGS: "-race", GOPROXY: "https://unexpected.invalid", GOCACHE: "/shared/cache" });
  assert.deepEqual(plan.map((entry) => entry.target), ["darwin-amd64", "darwin-arm64", "linux-amd64", "linux-arm64"]);
  for (const entry of plan) {
    assert.deepEqual(entry.args, ["build", "-mod=readonly", "-trimpath", "-buildvcs=false", "-ldflags=-s -w -buildid=", "-o", entry.executable, "."]);
    assert.equal(entry.cwd, "/source with spaces/packages/setup-tui");
    assert.equal(entry.env.GOTOOLCHAIN, "local"); assert.equal(entry.env.CGO_ENABLED, "0");
    assert.equal(entry.env.GOPROXY, "off"); assert.equal(entry.env.GOSUMDB, "off");
    assert.equal(entry.env.GOWORK, "off"); assert.equal(entry.env.GOFLAGS, "");
    assert.equal(entry.env.GOCACHE, "/shared/cache");
    assert.equal(`${entry.env.GOOS}-${entry.env.GOARCH}`, entry.target);
  }
});
test("runtime inventories four executable targets and their exact checksums deterministically", (t) => {
  const f = fixture(t), first = f.build(), bytes = readFileSync(first.archive);
  assert.deepEqual(readFileSync(f.build().archive), bytes);
  const checked = inspectRuntime(bytes, readFileSync(join(f.output, "runtime-manifest.json")));
  for (const target of setupTargets) {
    const path = `packages/setup-tui/dist/alfred-setup-${target}`;
    assert.equal(checked.files.get(path).mode, 0o755);
    assert.equal(checked.manifest.files.find((file) => file.path === path).sha256, f.binaries[target].sha256);
  }
  assert.ok(checked.files.has("packages/setup-tui/dist/manifest.json"));
});
test("packaging fails closed on absent, corrupted, or wrong-platform setup binaries", (t) => {
  const f = fixture(t), target = setupTargets[0], path = join(f.root, "packages/setup-tui/dist", f.binaries[target].file);
  rmSync(path); assert.throws(f.build, /ENOENT/);
  f.put(path, Buffer.from("bad executable")); assert.throws(f.build, /checksum mismatch/);
  const wrong = binary("linux-amd64"); f.put(path, wrong);
  f.binaries[target].sha256 = sha256(wrong);
  f.put(f.manifestPath, { schema: "alfred.setup.binaries/v1", binaries: f.binaries });
  assert.throws(f.build, /Invalid setup TUI native executable/);
});
test("native binary headers distinguish each supported architecture", () => {
  for (const target of setupTargets) {
    assert.doesNotThrow(() => assertSetupBinary(binary(target), target));
    for (const other of setupTargets.filter((value) => value !== target)) assert.throws(() => assertSetupBinary(binary(other), target), /Invalid setup TUI/);
  }
});

test("compiled metadata must prove pinned frameworks, native target and reproducible build settings", () => {
  const info = `bin: go1.27.2
  dep github.com/charmbracelet/bubbletea v0.25.0 h1:sum
  dep github.com/charmbracelet/lipgloss v0.9.1 h1:sum
  build CGO_ENABLED=0
  build -trimpath=true
  build GOOS=linux
  build GOARCH=arm64
`;
  assert.doesNotThrow(() => verifySetupBuildInfo(info, "linux-arm64"));
  for (const [before, after] of [["v0.25.0", "v0.26.0"], ["CGO_ENABLED=0", "CGO_ENABLED=1"], ["-trimpath=true", "-trimpath=false"], ["GOARCH=arm64", "GOARCH=amd64"]]) assert.throws(() => verifySetupBuildInfo(info.replace(before, after), "linux-arm64"));
  assert.throws(() => verifySetupBuildInfo(info + "  => /local/replacement\n", "linux-arm64"), /replacements/);
  assert.throws(() => verifySetupBuildInfo(info + "  build vcs.revision=123\n", "linux-arm64"), /checkout metadata/);
});


test("published runtime policy includes the activation implementation and its safe merge dependency", () => {
  const policy = JSON.parse(readFileSync(new URL("../packaging/runtime/allowlist.json", import.meta.url)));
  assert.ok(policy.includes.includes("scripts/setup/activation.mjs"));
  assert.ok(policy.includes.includes("scripts/setup/bridge.mjs"));
  assert.ok(policy.includes.includes("scripts/setup/integration.mjs"));
  assert.ok(policy.includes.includes("scripts/setup/releases.mjs"));
  assert.ok(policy.includes.includes("packages/codex-adapter/src/**/*.js"));
});
