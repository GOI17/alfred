import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { normalizeComponents, legacyEdition, componentPlan, readComponentPreferences, saveComponentPreferences } from "../../packages/cli/src/components.mjs";
import { createSession, normalizeSelection, schema } from "./bridge.mjs";
import { run as setup } from "../../packages/cli/scripts/setup.mjs";
const root = resolve(import.meta.dirname, "../..");
const base = { edition: "coding", harnesses: ["codex-cli"], memory: "local-sqlite", name: "product", path: root, profiles: true };
function fixture(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "alfred-components-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const project = join(directory, "project"), home = join(directory, "home"); mkdirSync(project); mkdirSync(home);
  return { directory, project, home, env: { PATH: process.env.PATH, HOME: home, ALFRED_DISTRIBUTION: "homebrew" } };
}
const request = (id, operation, extra = {}) => ({ schema, id, operation, ...extra });
test("all seven component combinations are independent and legacy full never adds Workspace", () => {
  const ids = ["workspace", "memory", "harness"];
  for (let mask = 1; mask < 8; mask++) {
    const components = ids.filter((_, i) => mask & (1 << i)), selected = normalizeSelection({ ...base, components }, { packaged: true, installRoot: root });
    assert.deepEqual(selected.components, components); assert.equal(selected.edition, legacyEdition(components));
    assert.equal(selected.profiles, components.includes("harness"));
    assert.equal(selected.harnesses.length > 0, components.includes("harness"));
    assert.equal(selected.memory, components.includes("memory") ? "local-sqlite" : "decide-later");
    const plan = componentPlan(components); assert.equal(plan.includes("workspace"), components.includes("workspace")); assert.equal(plan.includes("memory-server"), components.includes("memory")); assert.equal(plan.includes("core"), components.includes("harness"));
  }
  assert.deepEqual(normalizeComponents(undefined, "full"), ["memory", "harness"]);
  assert.deepEqual(normalizeComponents(undefined, "coding"), ["harness"]);
  for (const components of [[], ["unknown"], ["workspace", "workspace"]]) assert.throws(() => normalizeComponents(components));
});
test("preferences read is write-free; approved writes are private, stale-safe, and reject symlinks", t => {
  const f = fixture(t); assert.equal(readComponentPreferences(f.project).value, null); assert.deepEqual(readdirSync(f.project), []);
  saveComponentPreferences(f.project, ["workspace"], "1.1.0", null);
  const stored = readComponentPreferences(f.project); assert.deepEqual(stored.value.components, ["workspace"]); assert.equal(statSync(stored.path).mode & 0o777, 0o600);
  assert.throws(() => saveComponentPreferences(f.project, ["memory"], "1.1.0", null));
  assert.deepEqual(readComponentPreferences(f.project).value.components, ["workspace"]);
  const unsafe = join(f.directory, "unsafe"); mkdirSync(unsafe); symlinkSync(f.home, join(unsafe, ".alfred")); assert.throws(() => readComponentPreferences(unsafe));
});
test("Workspace-only discover, check and preview do not write; apply records choices without peer setup", async t => {
  const f = fixture(t), session = createSession({ cwd: f.project, env: f.env, check: async () => ({ status: "offline", text: "Offline" }) });
  const selected = { ...base, components: ["workspace"] };
  const discovered = await session(request("d", "discover")); assert.deepEqual(discovered.data.defaults.components, ["harness"]);
  await session(request("c", "check-update"));
  const preview = await session(request("p", "preview", { selection: selected })); assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.match(preview.data.text, /Components:\s+workspace/); assert.match(preview.data.text, /After Apply, save these choices to .*components\.json/); assert.deepEqual(readdirSync(f.project), []); assert.deepEqual(readdirSync(f.home), []);
  const applied = await session(request("a", "apply", { selection: selected, previewToken: preview.data.previewToken, confirmed: true }));
  assert.equal(applied.ok, true, JSON.stringify(applied)); assert.equal(applied.data.status, "previews_only");
  assert.deepEqual(readComponentPreferences(f.project).value.components, ["workspace"]);
  for (const path of [".agents", ".codex", ".opencode", ".alfred/setup/installation.json", ".alfred/config.json"]) assert.equal(existsSync(join(f.project, path)), false, path);
  for (const path of [".alfred/runtime-profiles", ".alfred/registry.sqlite", ".alfred-workspace"]) assert.equal(existsSync(join(f.home, path)), false, path);
  const again = await createSession({ cwd: f.project, env: f.env })(request("d", "discover")); assert.deepEqual(again.data.defaults.components, ["workspace"]);
});
test("changed product choices invalidate reviewed apply before installer mutation", async t => {
  const f = fixture(t); let applies = 0;
  const session = createSession({ cwd: f.project, env: f.env, execute: async args => { if (args.includes("--apply")) applies++; return "review"; } });
  const selection = { ...base, components: ["workspace"] }, p = await session(request("p", "preview", { selection }));
  saveComponentPreferences(f.project, ["memory"], "1.1.0", null);
  const a = await session(request("a", "apply", { selection, previewToken: p.data.previewToken, confirmed: true })); assert.equal(a.error.code, "preview_changed"); assert.equal(applies, 0);
});
test("explicit setup flags expand only selected families and preserve legacy full", t => {
  const f = fixture(t); let argv;
  const dependencies = { root, cwd: f.project, spawnSync: (_command, args) => { argv = args; return { status: 0 }; } };
  assert.equal(setup(["--components=workspace"], f.env, { interactive: false }, dependencies), 0);
  assert.ok(argv.includes("--component=workspace")); assert.ok(argv.includes("--harness=none")); assert.ok(!argv.includes("--component=memory-server")); assert.ok(!argv.includes("--component=core"));
  setup(["--edition=full"], f.env, { interactive: false }, dependencies); assert.ok(!argv.includes("--component=workspace"));
  assert.throws(() => setup(["--components=workspace", "--edition=full"], f.env, { interactive: false }, dependencies));
});

test("explicit capabilities keep v1 harness receipts compatible and preserve integration update choices", async t => {
  const f = fixture(t), session = createSession({ cwd: f.project, env: f.env });
  const selection = { ...base, edition: "full", memory: "decide-later", profiles: false, components: ["memory", "harness"] };
  const p = await session(request("p", "preview", { selection })); assert.equal(p.ok, true);
  const a = await session(request("a", "apply", { selection, previewToken: p.data.previewToken, confirmed: true })); assert.equal(a.data.status, "activation_review", JSON.stringify(a));
  const activated = await session(request("activate", "activate", { selection, previewToken: a.data.previewToken, confirmed: true })); assert.equal(activated.data.status, "activation_verified", JSON.stringify(activated));
  const receipt = JSON.parse(readFileSync(join(f.project, ".alfred/setup/installation.json"), "utf8"));
  assert.equal(receipt.schema, "alfred.setup.installation/v1"); assert.equal(receipt.selection.edition, "full"); assert.equal("components" in receipt.selection, false);
  const preferences = readComponentPreferences(f.project); saveComponentPreferences(f.project, ["workspace"], "1.1.0", preferences.digest);
  const discovery = await createSession({ cwd: f.project, env: f.env })(request("d", "discover"));
  assert.equal(discovery.data.project.status, "managed"); assert.deepEqual(discovery.data.defaults.components, ["workspace"]); assert.deepEqual(discovery.data.defaults.harnesses, []);
  assert.deepEqual(discovery.data.integrationDefaults.harnesses, ["codex-cli"]); assert.equal(discovery.data.integrationDefaults.edition, "full"); assert.equal("components" in discovery.data.integrationDefaults, false);
});

test("explicit Homebrew component Apply persists in the caller project and survives rediscovery", async t => {
  const f = fixture(t);
  const invoke = args => spawnSync(process.execPath, [join(root, "packages/cli/scripts/alfred.mjs"), "setup", ...args], { cwd: f.project, env: f.env, encoding: "utf8", timeout: 10000 });
  for (const args of [
    ["--components=workspace"],
    ["--components=workspace", "--apply", "--dry-run"],
    ["--components=invalid", "--edition=full", "--apply", "--help"]
  ]) {
    const result = invoke(args); assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(f.project), []); assert.deepEqual(readdirSync(f.home), []);
  }
  const failed = invoke(["--components=workspace", "--apply", "--invalid-option"]);
  assert.notEqual(failed.status, 0); assert.deepEqual(readdirSync(f.project), []); assert.deepEqual(readdirSync(f.home), []);
  const applied = invoke(["--components=workspace", "--dry-run", "--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.ok(applied.stderr.includes(join(f.project, ".alfred/setup/components.json")));
  assert.match(applied.stderr, /After a successful Apply, save selected capabilities \(workspace\)/);
  const saved = readComponentPreferences(f.project);
  assert.deepEqual(saved.value.components, ["workspace"]); assert.equal(saved.value.project, f.project);
  assert.equal(saved.value.version, JSON.parse(readFileSync(join(root, "package.json"))).version);
  assert.equal(statSync(saved.path).mode & 0o777, 0o600);
  const discovered = await createSession({ cwd: f.project, env: f.env })(request("d", "discover"));
  assert.equal(discovered.ok, true, JSON.stringify(discovered)); assert.deepEqual(discovered.data.defaults.components, ["workspace"]);
  assert.equal(discovered.data.project.status, "none"); assert.equal(discovered.data.defaults.profiles, false); assert.deepEqual(discovered.data.defaults.harnesses, []);
  for (const path of [".agents", ".codex", ".opencode", ".alfred/setup/installation.json", ".alfred/config.json"]) assert.equal(existsSync(join(f.project, path)), false, path);
  for (const path of [".alfred/runtime-profiles", ".alfred/registry.sqlite", ".alfred-workspace"]) assert.equal(existsSync(join(f.home, path)), false, path);
});

test("explicit component failure or cancellation preserves previous choices and integration receipt", t => {
  for (const result of [{ status: 7 }, { status: null, signal: "SIGINT" }, { status: null, error: new Error("spawn failed") }]) {
    const f = fixture(t); saveComponentPreferences(f.project, ["memory"], "1.1.0", null);
    const before = readFileSync(readComponentPreferences(f.project).path, "utf8");
    const receiptPath = join(f.project, ".alfred/setup/installation.json"); writeFileSync(receiptPath, "existing integration receipt\n");
    const dependencies = { root, cwd: f.project, stderr: { write() {} }, spawnSync: () => result };
    const invoke = () => setup(["--components=workspace", "--apply"], f.env, { interactive: false }, dependencies);
    if (result.error) assert.throws(invoke, /spawn failed/); else assert.notEqual(invoke(), 0);
    assert.equal(readFileSync(readComponentPreferences(f.project).path, "utf8"), before);
    assert.equal(readFileSync(receiptPath, "utf8"), "existing integration receipt\n");
  }
});

test("explicit component Apply rejects stale preferences without overwriting newer choices or receipt", t => {
  const f = fixture(t); saveComponentPreferences(f.project, ["memory"], "1.1.0", null);
  const before = readComponentPreferences(f.project), receiptPath = join(f.project, ".alfred/setup/installation.json");
  writeFileSync(receiptPath, "existing integration receipt\n");
  let calls = 0, concurrent;
  const dependencies = { root, cwd: f.project, stderr: { write() {} }, spawnSync: (_command, _args, options) => {
    calls++; assert.equal(options.cwd, f.project);
    saveComponentPreferences(f.project, ["harness"], "1.1.0", before.digest);
    concurrent = readFileSync(before.path, "utf8"); return { status: 0 };
  } };
  assert.throws(() => setup(["--components=workspace", "--apply"], f.env, { interactive: false }, dependencies), /Setup completed, but product choices were not saved:.*changed since review.*Reopen setup/);
  assert.equal(calls, 1); assert.equal(readFileSync(before.path, "utf8"), concurrent);
  assert.equal(readFileSync(receiptPath, "utf8"), "existing integration receipt\n");
});

test("explicit components reject a forced TUI, while help remains non-mutating", t => {
  const f = fixture(t), env = { ...f.env, ALFRED_INSTALL_FORCE_TUI: "1" }; let calls = 0;
  const dependencies = { root, cwd: f.project, stderr: { write() {} }, spawnSync: () => { calls++; return { status: 0 }; } };
  assert.throws(() => setup(["--components=workspace", "--apply"], env, { interactive: true }, dependencies), /cannot be combined with a forced installer TUI/);
  assert.equal(calls, 0); assert.deepEqual(readdirSync(f.project), []);
  assert.equal(setup(["--components=invalid", "--edition=full", "--apply", "--help"], env, { interactive: true }, dependencies), 0);
  assert.equal(calls, 1); assert.deepEqual(readdirSync(f.project), []); assert.deepEqual(readdirSync(f.home), []);
});
