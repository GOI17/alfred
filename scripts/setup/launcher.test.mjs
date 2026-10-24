import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, symlinkSync, unlinkSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundledSetupBinary, run } from "../../packages/memory-server/scripts/setup.mjs";
import { handoffRuntimeUpgrade } from "./releases.mjs";

test("launcher validates exact target, executable digest and native header without executing untrusted bytes", t => {
  const root = mkdtempSync(join(tmpdir(), "alfred-setup-launcher-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, "packages/setup-tui/dist"); mkdirSync(directory, { recursive: true });
  const path = join(directory, "alfred-setup-linux-amd64"), bytes = Buffer.alloc(64);
  Buffer.from([0x7f,0x45,0x4c,0x46,2,1]).copy(bytes); bytes.writeUInt16LE(62,18);
  const manifest = { schema: "alfred.setup.binaries/v1", binaries: { "linux-amd64": { file: "alfred-setup-linux-amd64", sha256: createHash("sha256").update(bytes).digest("hex") } } };
  writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest)); writeFileSync(path, bytes, { mode: 0o755 });
  assert.equal(bundledSetupBinary(root, "linux", "x64"), path);
  assert.throws(() => bundledSetupBinary(root, "linux", "arm64"), /manifest/);
  assert.throws(() => bundledSetupBinary(root, "win32", "x64"), /support/);
  chmodSync(path, 0o644); assert.throws(() => bundledSetupBinary(root, "linux", "x64"), /integrity/);
  chmodSync(path, 0o755); writeFileSync(path, Buffer.from("wrong")); assert.throws(() => bundledSetupBinary(root, "linux", "x64"), /integrity/);
  unlinkSync(path); const other = join(root, "other"); writeFileSync(other, bytes, { mode: 0o755 }); symlinkSync(other, path);
  assert.throws(() => bundledSetupBinary(root, "linux", "x64"), /integrity/);
});

function launcherFixture(t) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "alfred launcher "));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "old runtime"), project = join(directory, "project with spaces"), prefix = join(directory, "new Homebrew prefix");
  mkdirSync(project); mkdirSync(join(prefix, "bin"), { recursive: true });
  const executable = join(prefix, "bin", "alfred"); writeFileSync(executable, "#!/bin/sh\n", { mode: 0o755 });
  const dist = join(root, "packages/setup-tui/dist"); mkdirSync(dist, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.0.1" }));
  const arch = process.arch === "x64" ? "amd64" : process.arch, target = `${process.platform}-${arch}`;
  const bytes = Buffer.alloc(64);
  if (process.platform === "darwin") { bytes.writeUInt32LE(0xfeedfacf, 0); bytes.writeUInt32LE(arch === "arm64" ? 0x0100000c : 0x01000007, 4); }
  else { Buffer.from([0x7f,0x45,0x4c,0x46,2,1]).copy(bytes); bytes.writeUInt16LE(arch === "arm64" ? 183 : 62, 18); }
  const file = `alfred-setup-${target}`, binary = join(dist, file);
  writeFileSync(binary, bytes, { mode: 0o755 });
  writeFileSync(join(dist, "manifest.json"), JSON.stringify({ schema: "alfred.setup.binaries/v1", binaries: { [target]: { file, sha256: createHash("sha256").update(bytes).digest("hex") } } }));
  const messages = [], calls = [];
  return { root, project, prefix, executable, binary, messages, calls, dependencies: { root, cwd: project, stderr: { write: value => messages.push(value) } } };
}
function approvedUI(f, options) { handoffRuntimeUpgrade({ currentVersion: "1.0.1", latestVersion: "1.1.0", cwd: f.project, installRoot: f.root, env: options.env }); return { status: 20 }; }

test("launcher upgrades once and relaunches the newly installed executable after the old runtime has been removed", t => {
  const f = launcherFixture(t); let requestPath;
  const execute = (command, args, options) => {
    f.calls.push({ command, args, options });
    if (command === f.binary) { requestPath = options.env.ALFRED_SETUP_UPGRADE_REQUEST; return approvedUI(f, options); }
    if (command === "brew" && args[0] === "update") return { status: 0 };
    if (command === "brew" && args[0] === "upgrade") { rmSync(f.root, { recursive: true }); return { status: 0 }; }
    if (command === "brew" && args[0] === "--prefix") return { status: 0, stdout: f.prefix + "\n" };
    if (args[0] === "version") return { status: 0, stdout: "alfred 1.1.0\n" };
    assert.equal(args[0], "setup"); assert.equal(options.env.ALFRED_SETUP_RESUME, "1");
    assert.equal(options.env.ALFRED_SETUP_UPGRADE_REQUEST, undefined); assert.equal(options.env.ALFRED_SETUP_UPGRADE_NONCE, undefined);
    return { status: 0 };
  };
  const result = run([], { ALFRED_DISTRIBUTION: "homebrew" }, { interactive: true }, { ...f.dependencies, spawnSync: execute });
  assert.equal(result, 0); assert.equal(existsSync(f.root), false); assert.equal(existsSync(requestPath), false);
  assert.deepEqual(f.calls.slice(1).map(call => [call.command, call.args]), [["brew", ["update"]], ["brew", ["upgrade", "GOI17/alfred/alfred"]], ["brew", ["--prefix", "GOI17/alfred/alfred"]], [f.executable, ["version"]], [f.executable, ["setup"]]]);
  for (const { options } of f.calls) assert.equal(options.cwd, f.project);
  assert.match(f.messages.join(""), /Opening the project update review/);
});

test("canceling setup and missing or forged handoffs never execute Brew", t => {
  for (const mode of ["cancel", "missing", "forged"]) {
    const f = launcherFixture(t);
    const execute = (command, args, options) => {
      f.calls.push(command); assert.equal(command, f.binary);
      if (mode === "cancel") return { status: 0 };
      if (mode === "forged") {
        approvedUI(f, options); const path = options.env.ALFRED_SETUP_UPGRADE_REQUEST;
        const data = JSON.parse(readFileSync(path, "utf8")); data.nonce = "b".repeat(64); writeFileSync(path, JSON.stringify(data));
      }
      return { status: 20 };
    };
    const result = run([], { ALFRED_DISTRIBUTION: "homebrew" }, { interactive: true }, { ...f.dependencies, spawnSync: execute });
    assert.equal(result, mode === "cancel" ? 0 : 1); assert.equal(f.calls.length, 1);
  }
});

test("a failed Brew operation stops before project synchronization and does not replay approval", t => {
  const f = launcherFixture(t); let requestPath;
  const execute = (command, args, options) => {
    f.calls.push({ command, args });
    if (command === f.binary) { requestPath = options.env.ALFRED_SETUP_UPGRADE_REQUEST; return approvedUI(f, options); }
    assert.equal(command, "brew"); assert.deepEqual(args, ["update"]); return { status: 7 };
  };
  assert.equal(run([], { ALFRED_DISTRIBUTION: "homebrew" }, { interactive: true }, { ...f.dependencies, spawnSync: execute }), 7);
  assert.equal(f.calls.length, 2); assert.equal(existsSync(requestPath), false); assert.match(f.messages.join(""), /Project integration was not changed/);
});

test("a lagging installed version is not reported as success or relaunched", t => {
  const f = launcherFixture(t);
  const execute = (command, args, options) => {
    f.calls.push({ command, args });
    if (command === f.binary) return approvedUI(f, options);
    if (args[0] === "--prefix") return { status: 0, stdout: f.prefix };
    if (command === "brew") return { status: 0 };
    assert.deepEqual(args, ["version"]); return { status: 0, stdout: "alfred 1.0.1\n" };
  };
  assert.equal(run([], { ALFRED_DISTRIBUTION: "homebrew" }, { interactive: true }, { ...f.dependencies, spawnSync: execute }), 1);
  assert.equal(f.calls.some(call => call.args[0] === "setup"), false); assert.match(f.messages.join(""), /has not installed the reviewed version/);
});

test("explicit flags, legacy UI and non-TTY keep the deterministic installer route", t => {
  const f = launcherFixture(t);
  for (const [args, terminal] of [[["--edition=coding"], { interactive: true }], [["--legacy-ui"], { interactive: true }], [[], { interactive: false }]]) {
    let count = 0;
    const result = run(args, { ALFRED_DISTRIBUTION: "homebrew", ALFRED_SETUP_UPGRADE_REQUEST: "/untrusted/request.json", ALFRED_SETUP_UPGRADE_NONCE: "a".repeat(64) }, terminal, { ...f.dependencies, spawnSync: (command, argv, options) => {
      count++; assert.equal(command, "sh"); assert.equal(argv[0], join(f.root, "install.sh")); assert.ok(argv.includes(`--path=${f.root}`)); assert.ok(argv.includes("--no-clone"));
      assert.equal(options.env.ALFRED_SETUP_UPGRADE_REQUEST, undefined); assert.equal(options.env.ALFRED_SETUP_UPGRADE_NONCE, undefined); return { status: 0 };
    } });
    assert.equal(result, 0); assert.equal(count, 1);
  }
});
