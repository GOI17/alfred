import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { run: init } = await import("../scripts/init.mjs");

function withFreshRegistry(fn) {
  const dir = mkdtempSync(join(tmpdir(), "alfred-init-"));
  const regPath = join(dir, "registry.sqlite");
  const prev = process.env.ALFRED_MEMORY_REGISTRY;
  process.env.ALFRED_MEMORY_REGISTRY = regPath;
  const prevHome = process.env.HOME;
  process.env.HOME = dir;
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      try {
        if (prev === undefined) delete process.env.ALFRED_MEMORY_REGISTRY;
        else process.env.ALFRED_MEMORY_REGISTRY = prev;
        if (prevHome === undefined) delete process.env.HOME;
        else process.env.HOME = prevHome;
      } catch {}
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    });
}

test("init coding profile creates sqlite tenant + workspace + config.json", async () => {
  await withFreshRegistry(async (dir) => {
    const cwd = join(dir, "workspace");
    const { execSync } = await import("node:child_process");
    execSync(`mkdir -p "${cwd}"`);

    const { code, output } = await runWithCapture(init, [
      "--profile=coding",
      "--name=acme",
      "--cwd=" + cwd,
      "--non-interactive"
    ]);
    assert.equal(code, 0, output);
    const json = JSON.parse(extractJson(output));
    assert.equal(json.profile, "coding");
    assert.equal(json.tenant_id.startsWith("usr_t_"), true);
    assert.equal(json.workspace_id?.startsWith("usr_ws_"), true);
    assert.ok(json.api_key.startsWith("alk_"));
    assert.ok(existsSync(json.config_path));
    const cfg = JSON.parse(readFileSync(json.config_path, "utf8"));
    assert.equal(cfg.tenant.id, json.tenant_id);
    assert.equal(cfg.api_key, json.api_key);
  });
});

test("init web profile does NOT write a workspace config", async () => {
  await withFreshRegistry(async (dir) => {
    const { code, output } = await runWithCapture(init, [
      "--profile=web",
      "--name=my-mem",
      "--db-connection=postgres://localhost/x",
      "--non-interactive"
    ]);
    assert.equal(code, 0, output);
    const json = JSON.parse(extractJson(output));
    assert.equal(json.profile, "web");
    assert.equal(json.workspace_id, null);
    assert.equal(json.config_path, undefined);
    // Next steps mention ChatGPT, Claude, Gemini.
    assert.match(output, /ChatGPT/);
    assert.match(output, /Claude/);
    assert.match(output, /Gemini/);
  });
});

test("init web profile with sqlite fails with hosting-policy error", async () => {
  await withFreshRegistry(async () => {
    const { code, output } = await runWithCapture(init, [
      "--profile=web",
      "--name=my-mem",
      "--backend=sqlite",
      "--db-path=/tmp/x.sqlite",
      "--non-interactive"
    ]);
    assert.notEqual(code, 0);
    assert.match(output, /Postgres/);
  });
});

test("init both profile produces hybrid_with_human + workspace + web steps", async () => {
  await withFreshRegistry(async (dir) => {
    const cwd = join(dir, "ws");
    const { execSync } = await import("node:child_process");
    execSync(`mkdir -p "${cwd}"`);

    const { code, output } = await runWithCapture(init, [
      "--profile=both",
      "--name=shared",
      "--cwd=" + cwd,
      "--db-connection=postgres://localhost/x",
      "--non-interactive"
    ]);
    assert.equal(code, 0, output);
    const json = JSON.parse(extractJson(output));
    assert.equal(json.profile, "both");
    assert.equal(json.workspace_id?.startsWith("usr_ws_"), true);
    assert.ok(json.api_key.startsWith("alk_"));
    // Next steps on stderr mention both coding and web.
    assert.match(output, /coding \+ web/);
    assert.match(output, /adapters instructions/);
  });
});

test("init --print-only does not create any state", async () => {
  await withFreshRegistry(async (dir) => {
    const { code, output } = await runWithCapture(init, [
      "--profile=coding",
      "--name=acme",
      "--cwd=" + dir,
      "--print-only"
    ]);
    assert.equal(code, 0);
    const json = JSON.parse(extractJson(output));
    assert.equal(json.ok, true);
    assert.equal(json.plan.profile, "coding");
    // No tenant id yet (it was a plan, not an execution).
    assert.equal(json.tenant_id, undefined);
  });
});

test("init unknown profile returns 2", async () => {
  await withFreshRegistry(async () => {
    const { code, output } = await runWithCapture(init, [
      "--profile=made-up",
      "--non-interactive"
    ]);
    assert.equal(code, 2);
    assert.match(output, /Unknown profile/);
  });
});

// Helpers
async function runWithCapture(fn, args) {
  const out = captureStderr();
  const code = await Promise.resolve(fn(args)).catch((err) => {
    out.err += err.message;
    return 1;
  });
  return { code, output: out.all() };
}
function captureStderr() {
  let buf = "";
  let stdoutBuf = "";
  const origErr = process.stderr.write.bind(process.stderr);
  const origOut = process.stdout.write.bind(process.stdout);
  process.stderr.write = (s) => { buf += s; return true; };
  process.stdout.write = (s) => { stdoutBuf += s; return true; };
  return {
    get err() { return buf; },
    get out() { return stdoutBuf; },
    all() { return stdoutBuf + buf; }
  };
}
function extractJson(text) {
  // JSON output is the first {...} block on stdout (init writes JSON on stdout, plan on stderr).
  const start = text.indexOf("{");
  if (start < 0) throw new Error("no JSON in: " + text);
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}
