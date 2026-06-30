// Tests the TUI dashboard's data path. We test runTui's --json mode which
// bypasses raw-mode terminal handling and emits a snapshot.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { runTui } = await import("../tui/dashboard.mjs");

function withFreshRegistry(fn) {
  const dir = mkdtempSync(join(tmpdir(), "alfred-tui-"));
  const prev = process.env.ALFRED_MEMORY_REGISTRY;
  process.env.ALFRED_MEMORY_REGISTRY = join(dir, "registry.sqlite");
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

test("dashboard --json prints snapshot and exits", async () => {
  await withFreshRegistry(async (dir) => {
    // Capture stdout
    let buf = "";
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s) => { buf += s; return true; };
    try {
      const code = await runTui(["--json"]);
      assert.equal(code, 0);
    } finally {
      process.stdout.write = orig;
    }
    const json = JSON.parse(buf);
    assert.ok(Array.isArray(json.tenants));
    assert.ok(Array.isArray(json.keys));
    assert.ok(json.registry.endsWith("registry.sqlite"));
  });
});

test("dashboard --json includes provisioned tenants", async () => {
  await withFreshRegistry(async () => {
    // Provision a tenant directly via the registry.
    const { openRegistry } = await import("../../memory-server/src/registry/store-factory.js");
    const { createTenantService } = await import("../../memory/src/index.js");
    const registry = await openRegistry();
    try {
      const svc = createTenantService({ store: registry.tenants });
      await svc.provisionTenant({
        kind: "coding_agent_only", storage_backend: "sqlite", db_path: "/tmp/x.sqlite"
      });
    } finally { registry.close(); }

    let buf = "";
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s) => { buf += s; return true; };
    try {
      await runTui(["--json"]);
    } finally { process.stdout.write = orig; }
    const json = JSON.parse(buf);
    assert.equal(json.tenants.length, 1);
    assert.equal(json.tenants[0].kind, "coding_agent_only");
  });
});

test("dashboard rejects non-TTY invocation in interactive mode", async () => {
  await withFreshRegistry(async () => {
    let errBuf = "";
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (s) => { errBuf += s; return true; };
    let code = 0;
    try {
      code = await runTui([]);  // no --json, no TTY
    } finally { process.stderr.write = origErr; }
    assert.equal(code, 2);
    assert.match(errBuf, /TTY/);
  });
});
