import { test } from "node:test";
import assert from "node:assert/strict";
import { run as provision } from "../scripts/provision.mjs";
import { run as listTenants } from "../scripts/list.mjs";
import { run as validatePolicy } from "../scripts/validate-policy.mjs";
import { run as keyRotate } from "../scripts/key-rotate.mjs";
import { run as keyList } from "../scripts/key-list.mjs";
import { run as migrate } from "../scripts/migrate.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function withFreshRegistry(fn) {
  const dir = mkdtempSync(join(tmpdir(), "alfred-cli-"));
  const path = join(dir, "registry.sqlite");
  const prev = process.env.ALFRED_MEMORY_REGISTRY;
  process.env.ALFRED_MEMORY_REGISTRY = path;
  const origHome = process.env.HOME;
  process.env.HOME = dir;  // ensure derived paths stay in our tmp
  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      try {
        if (prev === undefined) delete process.env.ALFRED_MEMORY_REGISTRY;
        else process.env.ALFRED_MEMORY_REGISTRY = prev;
      } catch {}
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    });
}

function captureStdout(fn) {
  const orig = process.stdout.write.bind(process.stdout);
  let buf = "";
  process.stdout.write = (s) => { buf += s; return true; };
  return Promise.resolve(fn()).then((code) => {
    process.stdout.write = orig;
    return { code, output: buf };
  });
}

function captureStderr(fn) {
  const orig = process.stderr.write.bind(process.stderr);
  let buf = "";
  process.stderr.write = (s) => { buf += s; return true; };
  return Promise.resolve(fn()).then((code) => {
    process.stderr.write = orig;
    return { code, output: buf };
  });
}

test("provision rejects missing args with non-zero exit", async () => {
  await withFreshRegistry(async () => {
    const { code } = await captureStderr(() => provision([]));
    assert.notEqual(code, 0);
  });
});

test("provision succeeds for coding_agent_only sqlite", async () => {
  await withFreshRegistry(async () => {
    const { code, output } = await captureStdout(() => provision([
      "--kind", "coding_agent_only",
      "--backend", "sqlite",
      "--name", "Test",
      "--db-path", "/tmp/test.sqlite"
    ]));
    assert.equal(code, 0);
    const json = JSON.parse(output);
    assert.equal(json.ok, true);
    assert.equal(json.tenant.storage_backend, "sqlite");
  });
});

test("provision rejects human_agent + sqlite", async () => {
  await withFreshRegistry(async () => {
    const { code, output } = await captureStderr(() => provision([
      "--kind", "human_agent",
      "--backend", "sqlite",
      "--name", "Test",
      "--db-path", "/tmp/test.sqlite"
    ]));
    assert.notEqual(code, 0);
    assert.match(output, /postgres/i);
  });
});

test("list returns structured output", async () => {
  await withFreshRegistry(async () => {
    const { code, output } = await captureStdout(() => listTenants([]));
    assert.equal(code, 0);
    const json = JSON.parse(output);
    assert.ok(Array.isArray(json.items));
  });
});

test("validate-policy returns a report", async () => {
  await withFreshRegistry(async () => {
    const { code, output } = await captureStdout(() => validatePolicy([]));
    assert.equal(code, 0);
    const json = JSON.parse(output);
    assert.equal(json.ok, true);
  });
});

test("key-rotate returns a fresh api_key", async () => {
  await withFreshRegistry(async () => {
    // First provision a tenant with key list to verify rotation works.
    const { code: pcode, output: poutput } = await captureStdout(() => provision([
      "--kind", "coding_agent_only",
      "--backend", "sqlite",
      "--name", "TestRotate",
      "--db-path", "/tmp/test-rotate.sqlite"
    ]));
    assert.equal(pcode, 0);
    const tid = JSON.parse(poutput).tenant.id;

    const { code, output } = await captureStdout(() => keyRotate([
      "--tenant", tid, "--label", "rotate"
    ]));
    assert.equal(code, 0);
    const json = JSON.parse(output);
    assert.ok(json.api_key.startsWith("alk_"));
  });
});

test("key-list returns keys for a tenant", async () => {
  await withFreshRegistry(async () => {
    const { code: pcode, output: poutput } = await captureStdout(() => provision([
      "--kind", "coding_agent_only",
      "--backend", "sqlite",
      "--name", "TestList",
      "--db-path", "/tmp/test-list.sqlite"
    ]));
    assert.equal(pcode, 0);
    const tid = JSON.parse(poutput).tenant.id;
    const { code, output } = await captureStdout(() => keyList(["--tenant", tid]));
    assert.equal(code, 0);
    const json = JSON.parse(output);
    assert.ok(Array.isArray(json.keys));
  });
});

test("migrate rejects missing tenant args", async () => {
  await withFreshRegistry(async () => {
    const { code } = await captureStderr(() => migrate([]));
    assert.notEqual(code, 0);
  });
});
