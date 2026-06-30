// Tests the web console router. Uses fake req/res (sandbox blocks real network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { createConsoleRouter } = await import("../src/console-router.js");
const {
  createTenantService,
  createUserService,
  createInMemoryTenantStore,
  createInMemoryUserStore
} = await import("../../memory/src/index.js");

function makeServices() {
  const tenantStore = createInMemoryTenantStore();
  const tenantService = createTenantService({ store: tenantStore });
  const userStore = createInMemoryUserStore();
  const userService = createUserService({ store: userStore });
  return { tenantService, userService, userStore, tenantStore };
}

function captureRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: "",
    chunks: [],
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    writeHead(s, h) { this.statusCode = s; for (const [k,v] of Object.entries(h||{})) this.setHeader(k,v); },
    write(c) { this.chunks.push(typeof c==="string"?c:c.toString()); },
    end(c) { if (c!==undefined) this.write(c); this.body = this.chunks.join(""); },
    once() {}, on() {}
  };
  return res;
}

function makeReq({ method = "GET", url = "/", headers = {}, body = undefined } = {}) {
  const r = {
    method,
    url,
    headers,
    [Symbol.asyncIterator]() {
      const chunks = body !== undefined ? [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))] : [];
      let i = 0;
      return {
        next: () => i < chunks.length
          ? Promise.resolve({ value: chunks[i++], done: false })
          : Promise.resolve({ value: undefined, done: true })
      };
    }
  };
  return r;
}

async function invoke(handler, req) {
  const res = captureRes();
  await handler(req, res);
  return res;
}

test("GET /console returns 200 with text/html", async () => {
  const { tenantService, userService } = makeServices();
  // Resolve the console-web dist from the workspace root.
  const { existsSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const consoleDist = resolve("/Users/josegilbertoolivasibarra/Documents/personal/workspace/alfred", "packages/console-web/dist");
  assert.ok(existsSync(consoleDist + "/index.html"), "console-web must be built: run \"npm run build\" in packages/console-web");
  const router = createConsoleRouter({ userService, tenantService, config: {}, consoleDirOverride: consoleDist });
  const res = await invoke(router, makeReq({ url: "/console" }));
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"] || "", /text\/html/);
  assert.ok(res.body.length > 100);
});

test("GET /console/api/tenants returns a list", async () => {
  const { tenantService, userService } = makeServices();
  await tenantService.provisionTenant({
    kind: "coding_agent_only", storage_backend: "sqlite", db_path: "/tmp/x.sqlite"
  });
  const router = createConsoleRouter({ userService, tenantService, config: {}, consoleDirOverride: "" });
  const res = await invoke(router, makeReq({ url: "/console/api/tenants" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.items.length, 1);
});

test("POST /console/api/tenants/<id>/keys issues a new key", async () => {
  const { tenantService, userService, userStore, tenantStore } = makeServices();
  const tenant = await tenantService.provisionTenant({
    kind: "coding_agent_only", storage_backend: "sqlite", db_path: "/tmp/x.sqlite"
  });
  await userStore.addTenantStub(tenant);
  const router = createConsoleRouter({ userService, tenantService, config: {}, consoleDirOverride: "" });
  const res = await invoke(router, makeReq({
    method: "POST",
    url: `/console/api/tenants/${tenant.id}/keys`,
    headers: { "authorization": "Bearer alk_does_not_matter" },
    body: { label: "console-test" }
  }));
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.ok(body.api_key.startsWith("alk_"));
  assert.equal(body.key.label, "console-test");
});

test("POST /console/api/tenants/<id>/keys without Authorization returns 401", async () => {
  const { tenantService, userService } = makeServices();
  const router = createConsoleRouter({ userService, tenantService, config: {}, consoleDirOverride: "" });
  const res = await invoke(router, makeReq({
    method: "POST",
    url: "/console/api/tenants/usr_t_x/keys",
    body: { label: "x" }
  }));
  assert.equal(res.statusCode, 401);
});

test("GET /console/api/tenants/<id>/keys returns keys list", async () => {
  const { tenantService, userService, userStore, tenantStore } = makeServices();
  const tenant = await tenantService.provisionTenant({
    kind: "coding_agent_only", storage_backend: "sqlite", db_path: "/tmp/x.sqlite"
  });
  await userStore.addTenantStub(tenant);
  await userService.provisionApiKey({ tenant_id: tenant.id, label: "first" });
  const router = createConsoleRouter({ userService, tenantService, config: {}, consoleDirOverride: "" });
  const res = await invoke(router, makeReq({
    method: "GET",
    url: `/console/api/tenants/${tenant.id}/keys`,
    headers: { "authorization": "Bearer alk_test" }
  }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.keys.length, 1);
  assert.equal(body.keys[0].label, "first");
});

test("DELETE /console/api/keys/<id> revokes the key", async () => {
  const { tenantService, userService, userStore, tenantStore } = makeServices();
  const tenant = await tenantService.provisionTenant({
    kind: "coding_agent_only", storage_backend: "sqlite", db_path: "/tmp/x.sqlite"
  });
  await userStore.addTenantStub(tenant);
  const { key } = await userService.provisionApiKey({ tenant_id: tenant.id });
  const router = createConsoleRouter({ userService, tenantService, config: {}, consoleDirOverride: "" });
  const res = await invoke(router, makeReq({
    method: "DELETE",
    url: `/console/api/keys/${key.id}`,
    headers: { "authorization": "Bearer alk_test" }
  }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  // Verify the key is now revoked.
  const all = await userService.listApiKeys(tenant.id, { includeRevoked: true });
  const k = all.find((x) => x.id === key.id);
  assert.ok(k.revoked_at);
});

test("OPTIONS preflight sets CORS headers", async () => {
  const { tenantService, userService } = makeServices();
  const router = createConsoleRouter({ userService, tenantService, config: {}, consoleDirOverride: "" });
  const res = await invoke(router, makeReq({
    method: "OPTIONS",
    url: "/console/api/tenants",
    headers: { origin: "https://console.example.com" }
  }));
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["access-control-allow-origin"], "https://console.example.com");
});

test("console index.html exists in source tree", () => {
  const path = "/Users/josegilbertoolivasibarra/Documents/personal/workspace/alfred/packages/console-web/src/index.html";
  assert.ok(existsSync(path), "index.html must exist at " + path);
  const text = readFileSync(path, "utf8");
  assert.match(text, /<title>Alfred Memory/);
  assert.match(text, /setKey/);
  assert.match(text, /issueKey/);
  assert.match(text, /loadTenants/);
  assert.match(text, /loadKeys/);
});

test("console index.html contains explanation for non-technical users", () => {
  const path = "/Users/josegilbertoolivasibarra/Documents/personal/workspace/alfred/packages/console-web/src/index.html";
  const text = readFileSync(path, "utf8");
  // Non-technical copy: "Welcome", "Paste an API key", "connected services"
  assert.match(text, /Welcome/);
  assert.match(text, /Paste an API key/);
  assert.match(text, /Connected services/);
  assert.match(text, /Memory is never written here/);
});


// ============================================================================
// Decoupling tests: server doesn't depend on the console-web package at
// the package level. The console is wired at runtime via env vars or
// auto-discovery. If neither is set, the server returns 503.
// ============================================================================

test("GET /console with ALFRED_CONSOLE_DIR set to a dist dir returns the HTML", async () => {
  // Build a temp dir with a fake dist/index.html inside.
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dist = mkdtempSync(join(tmpdir(), "alfred-console-dist-"));
  try {
    writeFileSync(join(dist, "index.html"), "<!doctype html><html><body>HELLO_CONSOLE</body></html>");
    const prev = process.env.ALFRED_CONSOLE_DIR;
    process.env.ALFRED_CONSOLE_DIR = dist;
    try {
      const { tenantService, userService } = makeServices();
      // No consoleDirOverride: the env var alone is enough to bypass
      // auto-discovery. The "" sentinel would force 503, so we omit it.
      const router = createConsoleRouter({ userService, tenantService, config: {} });
      const res = await invoke(router, makeReq({ url: "/console" }));
      assert.equal(res.statusCode, 200);
      assert.match(res.body, /HELLO_CONSOLE/);
    } finally {
      if (prev === undefined) delete process.env.ALFRED_CONSOLE_DIR;
      else process.env.ALFRED_CONSOLE_DIR = prev;
      rmSync(dist, { recursive: true, force: true });
    }
  } catch (e) { rmSync(dist, { recursive: true, force: true }); throw e; }
});

test("GET /console with ALFRED_CONSOLE_DIR pointing to a file (index.html) also works", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "alfred-console-file-"));
  const file = join(dir, "index.html");
  try {
    writeFileSync(file, "<!doctype html><html>FILE_MODE</html>");
    const prev = process.env.ALFRED_CONSOLE_DIR;
    process.env.ALFRED_CONSOLE_DIR = file;
    try {
      const { tenantService, userService } = makeServices();
      // No consoleDirOverride: env var alone is honored.
      const router = createConsoleRouter({ userService, tenantService, config: {} });
      const res = await invoke(router, makeReq({ url: "/console" }));
      assert.equal(res.statusCode, 200);
      assert.match(res.body, /FILE_MODE/);
    } finally {
      if (prev === undefined) delete process.env.ALFRED_CONSOLE_DIR;
      else process.env.ALFRED_CONSOLE_DIR = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
});

test("GET /console with no console installed returns 503 with instructions", async () => {
  const prev1 = process.env.ALFRED_CONSOLE_DIR;
  const prev2 = process.env.ALFRED_CONSOLE_URL;
  delete process.env.ALFRED_CONSOLE_DIR;
  delete process.env.ALFRED_CONSOLE_URL;
  // Set cwd to a known-empty tmp dir to prevent auto-discovery from finding
  // anything in the workspace.
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const emptyDir = mkdtempSync(join(tmpdir(), "alfred-empty-"));
  const prevCwd = process.cwd();
  process.chdir(emptyDir);
  try {
    const { tenantService, userService } = makeServices();
    const router = createConsoleRouter({ userService, tenantService, config: {}, consoleDirOverride: "" });
    const res = await invoke(router, makeReq({ url: "/console" }));
    assert.equal(res.statusCode, 503);
    const body = JSON.parse(res.body);
    assert.equal(body.error.code, "console_not_installed");
    assert.match(body.error.message, /console-web/);
  } finally {
    if (prev1 === undefined) delete process.env.ALFRED_CONSOLE_DIR;
    else process.env.ALFRED_CONSOLE_DIR = prev1;
    if (prev2 === undefined) delete process.env.ALFRED_CONSOLE_URL;
    else process.env.ALFRED_CONSOLE_URL = prev2;
    process.chdir(prevCwd);
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test("GET /console with ALFRED_CONSOLE_URL set redirects to upstream", async () => {
  const prev1 = process.env.ALFRED_CONSOLE_DIR;
  const prev2 = process.env.ALFRED_CONSOLE_URL;
  delete process.env.ALFRED_CONSOLE_DIR;
  process.env.ALFRED_CONSOLE_URL = "https://console.alfred.example.com/";
  try {
    const { tenantService, userService } = makeServices();
    const router = createConsoleRouter({ userService, tenantService, config: {}, consoleDirOverride: "" });
    const res = await invoke(router, makeReq({ url: "/console" }));
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, "https://console.alfred.example.com/");
  } finally {
    if (prev1 === undefined) delete process.env.ALFRED_CONSOLE_DIR;
    else process.env.ALFRED_CONSOLE_DIR = prev1;
    if (prev2 === undefined) delete process.env.ALFRED_CONSOLE_URL;
    else process.env.ALFRED_CONSOLE_URL = prev2;
  }
});

test("GET /console/api/tenants works regardless of console install (API is always served)", async () => {
  const prev1 = process.env.ALFRED_CONSOLE_DIR;
  delete process.env.ALFRED_CONSOLE_DIR;
  try {
    const { tenantService, userService } = makeServices();
    const router = createConsoleRouter({ userService, tenantService, config: {}, consoleDirOverride: "" });
    const res = await invoke(router, makeReq({ url: "/console/api/tenants" }));
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.items));
  } finally {
    if (prev1 === undefined) delete process.env.ALFRED_CONSOLE_DIR;
    else process.env.ALFRED_CONSOLE_DIR = prev1;
  }
});

test("GET /console/anything-else with cross-origin upstream redirects to upstream + path", async () => {
  const prev2 = process.env.ALFRED_CONSOLE_URL;
  process.env.ALFRED_CONSOLE_URL = "https://console.alfred.example.com";
  try {
    const { tenantService, userService } = makeServices();
    const router = createConsoleRouter({ userService, tenantService, config: {}, consoleDirOverride: "" });
    const res = await invoke(router, makeReq({ url: "/console/some/path" }));
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, "https://console.alfred.example.com/some/path");
  } finally {
    if (prev2 === undefined) delete process.env.ALFRED_CONSOLE_URL;
    else process.env.ALFRED_CONSOLE_URL = prev2;
  }
});

test("Console router does not require console-web at construction time", () => {
  // Just constructing the router should not read the filesystem.
  const { tenantService, userService } = makeServices();
  assert.doesNotThrow(() => {
    createConsoleRouter({ userService, tenantService, config: {}, consoleDirOverride: "" });
  });
});
