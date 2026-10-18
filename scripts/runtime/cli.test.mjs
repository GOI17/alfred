import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { run } from "./cli.mjs";

const dispatcher = fileURLToPath(new URL("../../packages/memory-server/scripts/alfred.mjs", import.meta.url));
const cli = new URL("./cli.mjs", import.meta.url).href;
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "alfred-cli-217-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(cwd);
  fs.mkdirSync(path.join(home, ".alfred/runtime"), { recursive: true });
  const content = "PRIVATE reviewed playbook\nActual content \u001b[31m stays JSON data\n";
  const source = path.join(root, "playbook.txt");
  fs.writeFileSync(source, content);
  const option = { id: "global-ts", source, contract: "read-text-v1", action: "load-instructions", scope: "typescript", digest: createHash("sha256").update(content).digest("hex") };
  const manifest = path.join(root, "instructions.json");
  write(manifest, { version: 1, instructions: [], options: [] });
  const catalog = path.join(home, ".alfred/runtime/options.json");
  write(catalog, { version: 1, options: [option] });
  const env = { ...process.env, HOME: home };
  const exec = (...args) => {
    const result = spawnSync(process.execPath, [dispatcher, "runtime", ...args], { cwd, env, encoding: "utf8", timeout: 5000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  };
  const init = () => exec("init", "--instructions", manifest);
  const args = ["run", "--cwd", cwd, "--action", option.action, "--scope", option.scope];
  const direct = () => write(manifest, { version: 1, instructions: [{ id: "alfred-ts", action: option.action, scope: option.scope, disposition: "execute", option: option.id }], options: [option] });
  const injected = async (answers, extra = [], hook) => {
    let stdout = "", stderr = "";
    const prompts = [];
    const code = await run([...args, ...extra], env, {
      interactive: true,
      stdout: { write: text => { stdout += text; } }, stderr: { write: text => { stderr += text; } },
      question: async prompt => { prompts.push(prompt); hook?.(prompt); return answers.shift(); }
    });
    return { code, data: JSON.parse(stdout), stderr, prompts };
  };
  const grants = () => JSON.parse(fs.readFileSync(path.join(cwd, ".alfred/runtime/grants.json"), "utf8"));
  return { root, cwd, home, content, source, option, manifest, catalog, env, exec, init, args, direct, injected, grants };
}

test("CLI subprocess help advertises bounded runtime and preserves Memory init help", t => {
  const f = fixture(t);
  const result = f.exec("--help");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /read-text-v1/);
  assert.match(result.stdout, /--non-interactive/);
  assert.equal(fs.existsSync(path.join(f.cwd, ".alfred")), false);
  const memory = spawnSync(process.execPath, [dispatcher, "init", "--help"], { cwd: f.cwd, env: f.env, encoding: "utf8", timeout: 5000 });
  assert.ifError(memory.error);
  assert.equal(memory.status, 0);
  assert.match(memory.stdout + memory.stderr, /profile/);
});

test("CLI subprocess init is idempotent, status finds ancestor, Memory config preserved", t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.cwd, ".alfred"));
  const memory = path.join(f.cwd, ".alfred/config.json");
  fs.writeFileSync(memory, '{"memory":"preserve exactly"}');
  assert.equal(f.init().status, 0);
  const first = fs.readFileSync(path.join(f.cwd, ".alfred/runtime/project.json"), "utf8");
  assert.equal(f.init().status, 0);
  assert.equal(fs.readFileSync(path.join(f.cwd, ".alfred/runtime/project.json"), "utf8"), first);
  const child = path.join(f.cwd, "nested");
  fs.mkdirSync(child);
  const status = f.exec("status", "--cwd", child);
  assert.equal(status.status, 0);
  assert.equal(JSON.parse(status.stdout).workspace_id, f.cwd);
  assert.equal(JSON.parse(status.stdout).grant_count, 0);
  assert.equal(fs.readFileSync(memory, "utf8"), '{"memory":"preserve exactly"}');
  assert.equal(fs.existsSync(path.join(f.home, ".alfred/registry.sqlite")), false);
});

test("CLI subprocess noninteractive cannot authorize either explicit or uniquely selected option", t => {
  const f = fixture(t);
  assert.equal(f.init().status, 0);
  for (const extra of [[], ["--option", f.option.id], ["--non-interactive"]]) {
    const result = f.exec(...f.args, ...extra);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).reason, "consent_required");
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.includes(f.content), false);
  }
  assert.equal(f.grants().grants.length, 0);
});

test("CLI subprocess Alfred direct route returns actual content and correlated private-safe local trace", t => {
  const f = fixture(t);
  f.direct();
  fs.writeFileSync(f.catalog, "not valid JSON: must never be discovered");
  assert.equal(f.init().status, 0);
  const result = f.exec(...f.args, "--non-interactive");
  assert.equal(result.status, 0);
  const data = JSON.parse(result.stdout);
  assert.equal(data.status, "completed");
  assert.equal(data.authority, "alfred");
  assert.equal(data.result.content, f.content);
  assert.equal(result.stdout.includes("\u001b"), false);
  assert.equal(result.stderr, "");
  const raw = fs.readFileSync(path.join(f.cwd, ".alfred/runtime/trace.jsonl"), "utf8");
  const events = raw.trim().split("\n").map(JSON.parse);
  const received = events.find(event => event.event === "runtime_request_received");
  assert.ok(received.request_id);
  const correlated = events.filter(event => event.request_id === received.request_id);
  assert.ok(correlated.some(event => event.event === "execution_completed"));
  assert.ok(correlated.some(event => event.event === "runtime_revalidated"));
  assert.equal(events.some(event => event.event === "external_options_discovered"), false);
  assert.equal(raw.includes("PRIVATE"), false);
  assert.equal(raw.includes(f.source), false);
  assert.equal(fs.existsSync(path.join(f.home, ".alfred/runtime/trace.jsonl")), false);
});

test("CLI subprocess invalid arguments fail structured without hanging or echoing controls", t => {
  const f = fixture(t);
  for (const args of [
    ["unknown"], ["init"], ["init", "--instructions", "relative.json"], ["status", "--action", "x"],
    ["run", "--action", "x"], ["run", "--action", "x", "--scope", "y", "--option"],
    ["run", "--action", "x", "--scope", "y", "--non-interactive", "--non-interactive"],
    ["run", "--action", "x", "--scope", "y", "--catalog", "elsewhere"],
    ["run", "--action", "\u001b[31m", "--scope", "y"]
  ]) {
    const result = f.exec(...args);
    assert.equal(result.status, 2);
    assert.deepEqual(JSON.parse(result.stdout), { status: "failed", reason: "invalid_arguments" });
    assert.equal(result.stderr, "");
  }
  const status = f.exec("status");
  assert.equal(status.status, 1);
  assert.equal(JSON.parse(status.stdout).status, "failed");
});

test("CLI interactive choice only selects; Once executes once, exact metadata shown", async t => {
  const f = fixture(t);
  f.init();
  const denied = await f.injected(["1", "yes"]);
  assert.equal(denied.code, 1);
  assert.equal(denied.data.reason, "invalid_consent");
  const result = await f.injected(["1", "Permitir"]);
  assert.equal(result.code, 0);
  assert.equal(result.data.result.content, f.content);
  assert.match(result.stderr, /Tengo estas opciones fuera de Alfred/);
  for (const field of [f.option.id, f.source, f.option.action, f.option.scope, f.option.digest]) assert.ok(result.stderr.includes(field));
  assert.equal(result.stderr.includes("PRIVATE"), false);
  assert.match(result.prompts[1], /Permitir \/ Permitir siempre \/ Cancelar/);
  assert.equal(f.grants().grants.length, 0);
  assert.equal(f.exec(...f.args).status, 1);
});

test("CLI interactive Always persists; fresh subprocess can reuse unique option grant", async t => {
  const f = fixture(t);
  f.init();
  const result = await f.injected(["Permitir siempre"], ["--option", f.option.id]);
  assert.equal(result.code, 0);
  assert.equal(f.grants().grants.length, 1);
  const replay = f.exec(...f.args, "--non-interactive");
  assert.equal(replay.status, 0);
  assert.equal(JSON.parse(replay.stdout).result.content, f.content);
  const altered = { ...f.option, scope: "other" };
  write(f.catalog, { version: 1, options: [altered] });
  assert.equal(f.exec("run", "--action", altered.action, "--scope", altered.scope).status, 1);
});

test("CLI selection and consent Cancelar both terminate; multiple options require explicit selection", async t => {
  const f = fixture(t);
  f.init();
  for (const answers of [["Cancelar"], ["1", "Cancelar"]]) {
    const result = await f.injected(answers);
    assert.equal(result.code, 1);
    assert.equal(result.data.status, "cancelled");
  }
  write(f.catalog, { version: 1, options: [f.option, { ...f.option, id: "second" }] });
  assert.equal(JSON.parse(f.exec(...f.args).stdout).reason, "selection_required");
  assert.equal(f.grants().grants.length, 0);
});

test("CLI rejects repeated unsafe arguments and escapes terminal formatting metadata", async t => {
  const f = fixture(t);
  f.init();
  for (let i = 0; i < 2; i++) {
    const result = await f.injected([], ["--option", "\u202eevil"]);
    assert.equal(result.code, 2);
  }
  const option = { ...f.option, id: "zero\u200bwidth" };
  write(f.catalog, { version: 1, options: [option] });
  const result = await f.injected(["Cancelar"]);
  assert.equal(result.stderr.includes("\u200b"), false);
  assert.ok(result.stderr.includes("\\u200b"));
});

test("CLI actual readline EOF resolves promptly without authorizing", async t => {
  const f = fixture(t);
  f.init();
  // Real readline with a controlled terminal stream; EOF occurs while question is pending.
  const input = new PassThrough();
  let stdout = "";
  const task = run(f.args, f.env, {
    interactive: true, stdin: input,
    stdout: { write: text => { stdout += text; } },
    stderr: { write: text => { if (text.includes("Selecciona")) queueMicrotask(() => input.end()); } }
  });
  assert.equal(await task, 1);
  assert.equal(JSON.parse(stdout).status, "cancelled");
  assert.equal(f.grants().grants.length, 0);
});

test("CLI subprocess forced interactive EOF exits with structured denial", t => {
  const f = fixture(t);
  f.init();
  const program = `import {run} from ${JSON.stringify(cli)}; process.stdin.isTTY = true; process.stderr.isTTY = true; process.exitCode = await run(${JSON.stringify([...f.args, "--option", f.option.id])});`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", program], { cwd: f.cwd, env: f.env, input: "", encoding: "utf8", timeout: 5000 });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).reason, "consent_required");
});

test("CLI refuses symlink trace destinations before managed execution", t => {
  const f = fixture(t);
  f.direct();
  f.init();
  const trace = path.join(f.cwd, ".alfred/runtime/trace.jsonl");
  const external = path.join(f.home, "untouched.txt");
  fs.writeFileSync(external, "unchanged");
  fs.unlinkSync(trace);
  fs.symlinkSync(external, trace);
  const result = f.exec(...f.args);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).status, "failed");
  assert.equal(fs.readFileSync(external, "utf8"), "unchanged");
});


test("CLI malformed manifest fails within correlated request trace without discovering globals", t => {
  const f = fixture(t);
  f.init();
  fs.writeFileSync(f.manifest, "invalid manifest");
  const result = f.exec(...f.args);
  assert.equal(result.status, 1);
  const events = fs.readFileSync(path.join(f.cwd, ".alfred/runtime/trace.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const received = events.find(event => event.event === "runtime_request_received");
  assert.ok(received);
  assert.ok(events.some(event => event.request_id === received.request_id && event.event === "runtime_request_failed"));
  assert.equal(events.some(event => event.event === "external_options_discovered"), false);
});
