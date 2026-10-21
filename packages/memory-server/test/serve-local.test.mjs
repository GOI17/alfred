import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadServeConfig, run } from "../scripts/serve.mjs";

const cli = fileURLToPath(new URL("../scripts/alfred.mjs", import.meta.url));

test("serve flags override the corresponding env settings and reject invalid requests", () => {
  const { config } = loadServeConfig(["--port=4321", "--bind", "localhost"], { ALFRED_MEMORY_PORT: "3000", ALFRED_MEMORY_BIND: "0.0.0.0" });
  assert.equal(config.port, 4321);
  assert.equal(config.bind, "127.0.0.1");
  for (const args of [["--bind", "0.0.0.0"], ["--bind=::"], ["--port"], ["--port=no"], ["--port=65536"], ["--hosting=self-hosted"], ["--unknown"]]) {
    assert.throws(() => loadServeConfig(args, {}));
  }
});

test("invalid serve configuration fails before creating the registry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "alfred-rejected-serve-"));
  const registry = join(dir, "never-opened.sqlite");
  const original = process.stderr.write;
  process.stderr.write = () => true;
  try {
    assert.equal(await run(["--bind=0.0.0.0"], { ALFRED_MEMORY_REGISTRY: registry }), 2);
    assert.equal(existsSync(registry), false);
  } finally { process.stderr.write = original; rmSync(dir, { recursive: true, force: true }); }
});

test("documented init/serve flow supports authenticated HTTP CRUD and local console on a custom port", { timeout: 20000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "alfred-local-http-"));
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith("ALFRED_")) delete env[name];
  env.ALFRED_MEMORY_REGISTRY = join(dir, "registry.sqlite");
  env.ALFRED_MEMORY_REQUIRE_AUTH = "true";
  let child;
  try {
    const init = spawnSync(process.execPath, [cli, "init", "--profile=coding", "--backend=sqlite", "--name", "my-memory", "--db-path", join(dir, "memory.sqlite"), "--cwd", dir, "--non-interactive"], { env, encoding: "utf8" });
    assert.equal(init.status, 0, "isolated init must succeed");
    const { api_key: key } = JSON.parse(init.stdout);
    assert.ok(key);
    child = spawn(process.execPath, [cli, "serve", "--bind=localhost", "--port", "0"], { env, stdio: ["ignore", "pipe", "pipe"] });
    const origin = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("local server did not become ready")), 8000);
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`local server exited: ${code}; ${output}`)); });
      child.stderr.on("data", (chunk) => {
        output += chunk;
        const match = /console: (http:\/\/127\.0\.0\.1:(\d+))\/console\//.exec(output);
        if (match) { clearTimeout(timer); assert.notEqual(Number(match[2]), 3000); assert.ok(Number(match[2]) > 0); resolve(match[1]); }
      });
    });
    assert.equal((await fetch(origin + "/memories")).status, 401);
    const consoleResponse = await fetch(origin + "/console/");
    assert.equal(consoleResponse.status, 200);
    const html = await consoleResponse.text();
    assert.doesNotMatch(html, /alfred-labs-memory\.fly\.dev/);
    assert.match(html, /window\.ALFRED_API_BASE = ""/);
    const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };
    const created = await fetch(origin + "/memories", { method: "POST", headers, body: JSON.stringify({ type: "fact", content: "local smoke", source: "test" }) });
    assert.equal(created.status, 201);
    const memory = await created.json();
    assert.equal((await fetch(origin + "/memories/" + memory.id, { headers })).status, 200);
    assert.equal((await fetch(origin + "/memories/" + memory.id, { method: "PATCH", headers, body: JSON.stringify({ content: "local update" }) })).status, 200);
    const list = await (await fetch(origin + "/memories", { headers })).json();
    assert.equal(list.items[0].content, "local update");
    assert.equal((await fetch(origin + "/memories/" + memory.id, { method: "DELETE", headers })).status, 200);
  } finally {
    if (child && child.exitCode === null) {
      const closed = once(child, "close"); child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 2000);
      await closed; clearTimeout(force);
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
