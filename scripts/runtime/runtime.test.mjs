import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { initializeRuntime, runtimeStatus, runManagedRequest } from "./service.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "alfred-runtime-service-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, "workspace");
  const home = path.join(root, "home");
  fs.mkdirSync(cwd); fs.mkdirSync(home);
  fs.mkdirSync(path.join(home, ".alfred/runtime"), { recursive: true });
  const source = path.join(root, "playbook.md");
  const content = "# TypeScript\nUse explicit boundaries.\n";
  fs.writeFileSync(source, content);
  const option = { id: "global-ts", source, contract: "read-text-v1", action: "load-instructions", scope: "typescript", digest: digest(content) };
  const manifest = path.join(root, "instructions.json");
  const catalog = path.join(home, ".alfred/runtime/options.json");
  const setManifest = (instructions = [], options = []) => write(manifest, { version: 1, instructions, options });
  const setCatalog = (options = [option]) => write(catalog, { version: 1, options });
  setManifest(); setCatalog();
  initializeRuntime({ cwd, instructions: manifest });
  const grantsFile = path.join(cwd, ".alfred/runtime/grants.json");
  const run = overrides => runManagedRequest({ cwd, home, action: option.action, scope: option.scope, option_id: option.id,
    consent: () => undefined, ...overrides });
  const consent = choice => (_request, _option, binding) => ({ choice, binding });
  const instruction = { id: "team-typescript", action: option.action, scope: option.scope, disposition: "execute", option: option.id };
  return { cwd, home, root, source, content, option, manifest, catalog, setManifest, setCatalog, grantsFile, run, consent, instruction };
}

test("init is idempotent, preserves Memory state and reports bounded capability from subdirectories", t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.cwd, ".alfred/config.json"), '{"memory":"unchanged"}');
  const before = fs.readFileSync(path.join(f.cwd, ".alfred/runtime/project.json"));
  initializeRuntime({ cwd: f.cwd, instructions: f.manifest });
  assert.deepEqual(fs.readFileSync(path.join(f.cwd, ".alfred/runtime/project.json")), before);
  assert.equal(fs.readFileSync(path.join(f.cwd, ".alfred/config.json"), "utf8"), '{"memory":"unchanged"}');
  fs.mkdirSync(path.join(f.cwd, "src"));
  const status = runtimeStatus({ cwd: path.join(f.cwd, "src") });
  assert.equal(status.workspace_id, f.cwd);
  assert.deepEqual(status.capabilities, ["read-text-v1"]);
  assert.match(status.boundary, /native host tools are not intercepted/);
});

test("matching Alfred instruction returns real playbook text without global discovery or consent", async t => {
  const f = fixture(t);
  f.setManifest([f.instruction], [f.option]);
  fs.writeFileSync(f.catalog, "malformed and must not be inspected");
  const result = await f.run({ consent: () => assert.fail("Alfred route cannot request external consent") });
  assert.equal(result.status, "completed");
  assert.equal(result.authority, "alfred");
  assert.equal(result.result.content, f.content);
});

for (const choice of ["once", "always", "cancel"]) test(`${choice} governs actual file output and project persistence`, async t => {
  const f = fixture(t);
  const result = await f.run({ consent: f.consent(choice) });
  assert.equal(result.status, choice === "cancel" ? "cancelled" : "completed");
  assert.equal(result.result?.content, choice === "cancel" ? undefined : f.content);
  assert.equal(JSON.parse(fs.readFileSync(f.grantsFile)).grants.length, choice === "always" ? 1 : 0);
  const restarted = await f.run();
  assert.equal(restarted.status, choice === "always" ? "completed" : "denied");
});

test("selection is explicit even for one external option", async t => {
  const f = fixture(t);
  const result = await f.run({ option_id: undefined, selectOption: () => undefined, consent: () => assert.fail("no selection") });
  assert.equal(result.reason, "selection_required");
  const selected = await f.run({ option_id: undefined, selectOption: () => f.option.id, consent: f.consent("once") });
  assert.equal(selected.result.content, f.content);
});

test("no source-content read occurs during discovery, selection or before consent", async t => {
  const f = fixture(t);
  fs.unlinkSync(f.source);
  // Metadata still resolves; opening source early would fail before the consent callback.
  let prompted = false;
  const result = await f.run({ consent: () => { prompted = true; return { choice: "cancel" }; } });
  assert.equal(prompted, true);
  assert.equal(result.status, "cancelled");
  assert.equal((await f.run()).reason, "consent_required");
});

test("content modified during consent never returns unapproved bytes", async t => {
  const f = fixture(t);
  const result = await f.run({ consent: (request, option, binding) => {
    fs.writeFileSync(f.source, "replacement content");
    return { choice: "once", binding };
  } });
  assert.equal(result.status, "failed");
  assert.equal(result.result, undefined);
});

test("changed valid manifest during consent is terminal even when still absent", async t => {
  const f = fixture(t);
  const result = await f.run({ consent: (request, option, binding) => {
    f.setManifest([{ id: "other", action: "another", scope: "different", disposition: "deny" }]);
    return { choice: "once", binding };
  } });
  assert.equal(result.reason, "revalidation_failed");
});

test("missing optional catalog is no_match while malformed catalog is failure", async t => {
  const f = fixture(t);
  fs.unlinkSync(f.catalog);
  assert.equal((await f.run()).status, "no_match");
  fs.writeFileSync(f.catalog, "{}");
  assert.equal((await f.run()).status, "failed");
});

test("malformed grants fail closed before source access", async t => {
  const f = fixture(t);
  f.setManifest([f.instruction], [f.option]);
  fs.writeFileSync(f.grantsFile, "{}");
  assert.equal((await f.run()).status, "failed");
});

test("ambiguous Alfred matches fail instead of discovering a global alternative", async t => {
  const f = fixture(t);
  f.setManifest([f.instruction, { ...f.instruction, id: "duplicate" }], [f.option]);
  const result = await f.run({ consent: () => assert.fail("must not discover fallback") });
  assert.equal(result.status, "failed");
});

test("unknown contracts and terminal control metadata fail closed", async t => {
  const f = fixture(t);
  for (const patch of [{ contract: "shell" }, { id: "global\u001b[2J" }, { scope: "a\nb" }, { source: "relative.md" }]) {
    f.setCatalog([{ ...f.option, ...patch }]);
    assert.equal((await f.run()).status, "failed");
  }
});

test("UTF-8 BOM is preserved; invalid UTF-8 and NUL are rejected without output", async t => {
  const f = fixture(t);
  for (const [content, expected] of [[Buffer.from("\ufefftext"), "\ufefftext"], [Buffer.from([0xff]), undefined], [Buffer.from("a\0b"), undefined]]) {
    fs.writeFileSync(f.source, content);
    f.option.digest = digest(content); f.setCatalog();
    const result = await f.run({ consent: f.consent("once") });
    assert.equal(result.status, expected === undefined ? "failed" : "completed");
    assert.equal(result.result?.content, expected);
  }
});

test("terminal outcomes and grant reuse have correlated traces without file content", async t => {
  const f = fixture(t);
  const events = [];
  await f.run({ consent: f.consent("always"), trace: event => events.push(event) });
  for (const name of ["runtime_request_received", "instruction_resolved", "external_options_discovered", "permission_evaluated", "consent_received", "runtime_revalidated", "execution_completed"]) {
    assert.ok(events.some(event => event.event === name), name);
  }
  assert.equal(new Set(events.map(event => event.request_id)).size, 1);
  assert.ok(!JSON.stringify(events).includes(f.content));
  const next = [];
  await f.run({ trace: event => next.push(event) });
  assert.ok(next.some(event => event.event === "project_grant_reused"));
  const cancelled = [];
  await f.run({ scope: "missing", trace: event => cancelled.push(event) });
  assert.ok(cancelled.some(event => event.event === "runtime_request_stopped"));
});


test("nested Git repositories and worktree markers never inherit parent grants", async t => {
  const f = fixture(t);
  assert.equal((await f.run({ consent: f.consent("always") })).status, "completed");
  for (const markerType of ["directory", "file"]) {
    const child = path.join(f.cwd, `nested-${markerType}`);
    fs.mkdirSync(child);
    if (markerType === "directory") fs.mkdirSync(path.join(child, ".git"));
    else fs.writeFileSync(path.join(child, ".git"), "gitdir: /shared/worktrees/child\n");
    fs.mkdirSync(path.join(child, "src"));
    assert.throws(() => runtimeStatus({ cwd: path.join(child, "src") }), /own runtime initialization/);
    await assert.rejects(() => f.run({ cwd: child }), /own runtime initialization/);
    initializeRuntime({ cwd: child, instructions: f.manifest });
    assert.equal((await f.run({ cwd: child })).reason, "consent_required");
  }
});
