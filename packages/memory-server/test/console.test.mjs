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


// ============================================================================
// v0.3.1 SaaS Web Onboarding: POST /console/api/bootstrap
// ============================================================================
//
// These tests exercise the bootstrap orchestrator with an in-memory registry
// and an injected mock schema provisioner (so no real Postgres is needed).
// The HTTP route is verified separately via a no-registry 503 test.

import {
  createBootstrap,
  createRateLimiter,
  createSchemaProvisioner
} from "../src/bootstrap/index.js";

async function makeServicesWithRegistry() {
  const { createInMemoryTenantStore, createInMemoryUserStore, createTenantService, createUserService } = await import("../../memory/src/index.js");
  const tenantStore = createInMemoryTenantStore();
  const userStore = createInMemoryUserStore();
  // Wire: every tenant added to tenantStore is also stubbed in userStore,
  // so userService.provisionApiKey() finds it.
  const _origCreate = tenantStore.createTenant.bind(tenantStore);
  tenantStore.createTenant = async (input) => {
    const t = await _origCreate(input);
    await userStore.addTenantStub(t);
    return t;
  };
  const tenantService = createTenantService({ store: tenantStore });
  const userService = createUserService({ store: userStore });
  const attempts = [];
  const emailVerifications = [];
  const registry = {
    async recordBootstrapAttempt(input) {
      attempts.push(input);
      return { id: input.id };
    },
    async countBootstrapAttempts({ ip, since }) {
      return attempts.filter((a) => a.ip === ip && a.attempted_at >= since).length;
    },
    async oldestBootstrapAttemptInWindow({ ip, since }) {
      const filtered = attempts.filter((a) => a.ip === ip && a.attempted_at >= since);
      if (filtered.length === 0) return null;
      return filtered.reduce((a, b) => a.attempted_at < b.attempted_at ? a : b);
    },
    emailVerifications: {
      async createEmailVerification(input) { emailVerifications.push(input); return { id: "emv_" + input.token.slice(0,8) }; },
      async findEmailVerificationByToken(token) { return emailVerifications.find((v) => v.token === token) ?? null; },
      async markEmailVerificationUsed(id) { const v = emailVerifications.find((x) => x.id === id); if (v) v.used_at = new Date().toISOString(); }
    }
  };
  return { tenantService, userService, registry, attempts, emailVerifications };
}

const MOCK_PROVISIONER = {
  async provision({ tenantId, sharedUrl }) {
    return { schema: "tenant_" + tenantId.replace(/^usr_t_/, ""), connectionString: sharedUrl + "?options=-c search_path=tenant_" + tenantId };
  }
};

test("createBootstrap with valid input returns tenant + alk_ key", async () => {
  const { tenantService, userService, registry } = await makeServicesWithRegistry();
  const bs = createBootstrap({
    tenantService, userService,
    rateLimiter: createRateLimiter({ registry }),
    schemaProvisioner: MOCK_PROVISIONER,
    sharedUrl: "postgres://localhost/alfred_saas"
  });
  const result = await bs.createTenantAndFirstKey({ ip: "1.2.3.4", displayName: "my-mem", kind: "human_agent" });
  assert.equal(result.tenant.kind, "human_agent");
  assert.equal(result.tenant.storage_backend, "postgres");
  assert.ok(result.api_key.startsWith("alk_"));
  assert.ok(result.key_prefix.startsWith("alk_"));
  assert.match(result.tenant.id, /^usr_t_[a-f0-9]{32}$/);
  // metadata may be a JSON string (SQLite) or object (in-memory); handle both.
  const meta = typeof result.tenant.metadata === "string" ? JSON.parse(result.tenant.metadata) : result.tenant.metadata;
  assert.equal(meta && meta.source, "web_bootstrap");
});

test("createBootstrap rejects empty display_name with validation_error", async () => {
  const { tenantService, userService, registry } = await makeServicesWithRegistry();
  const bs = createBootstrap({
    tenantService, userService,
    rateLimiter: createRateLimiter({ registry }),
    schemaProvisioner: MOCK_PROVISIONER,
    sharedUrl: "postgres://localhost/alfred_saas"
  });
  try {
    await bs.createTenantAndFirstKey({ ip: "1.2.3.4", displayName: "", kind: "human_agent" });
    assert.fail("should have thrown");
  } catch (err) {
    assert.equal(err.code, "validation_error");
    assert.equal(err.status, 400);
    assert.ok(err.details.find((d) => d.field === "display_name"));
  }
});

test("createBootstrap rejects display_name with invalid chars", async () => {
  const { tenantService, userService, registry } = await makeServicesWithRegistry();
  const bs = createBootstrap({
    tenantService, userService,
    rateLimiter: createRateLimiter({ registry }),
    schemaProvisioner: MOCK_PROVISIONER,
    sharedUrl: "postgres://localhost/alfred_saas"
  });
  try {
    await bs.createTenantAndFirstKey({ ip: "1.2.3.4", displayName: "bad<>name", kind: "human_agent" });
    assert.fail("should have thrown");
  } catch (err) {
    assert.equal(err.code, "validation_error");
  }
});

test("createBootstrap rejects kind=coding_agent_only", async () => {
  const { tenantService, userService, registry } = await makeServicesWithRegistry();
  const bs = createBootstrap({
    tenantService, userService,
    rateLimiter: createRateLimiter({ registry }),
    schemaProvisioner: MOCK_PROVISIONER,
    sharedUrl: "postgres://localhost/alfred_saas"
  });
  try {
    await bs.createTenantAndFirstKey({ ip: "1.2.3.4", displayName: "x", kind: "coding_agent_only" });
    assert.fail("should have thrown");
  } catch (err) {
    assert.equal(err.code, "validation_error");
    assert.ok(err.details.find((d) => d.field === "kind"));
  }
});

test("createBootstrap rejects kind=server_managed (operator-only)", async () => {
  const { tenantService, userService, registry } = await makeServicesWithRegistry();
  const bs = createBootstrap({
    tenantService, userService,
    rateLimiter: createRateLimiter({ registry }),
    schemaProvisioner: MOCK_PROVISIONER,
    sharedUrl: "postgres://localhost/alfred_saas"
  });
  try {
    await bs.createTenantAndFirstKey({ ip: "1.2.3.4", displayName: "x", kind: "server_managed" });
    assert.fail("should have thrown");
  } catch (err) {
    assert.equal(err.code, "validation_error");
  }
});

test("createBootstrap returns saas_not_configured when sharedUrl is null", async () => {
  const { tenantService, userService, registry } = await makeServicesWithRegistry();
  const bs = createBootstrap({
    tenantService, userService,
    rateLimiter: createRateLimiter({ registry }),
    schemaProvisioner: MOCK_PROVISIONER,
    sharedUrl: null
  });
  try {
    await bs.createTenantAndFirstKey({ ip: "1.2.3.4", displayName: "x", kind: "human_agent" });
    assert.fail("should have thrown");
  } catch (err) {
    assert.equal(err.code, "saas_not_configured");
    assert.equal(err.status, 503);
  }
});

test("createBootstrap rate limits after 5 attempts in the window", async () => {
  const { tenantService, userService, registry } = await makeServicesWithRegistry();
  const bs = createBootstrap({
    tenantService, userService,
    rateLimiter: createRateLimiter({ registry }),
    schemaProvisioner: MOCK_PROVISIONER,
    sharedUrl: "postgres://localhost/alfred_saas"
  });
  for (let i = 0; i < 5; i += 1) {
    const result = await bs.createTenantAndFirstKey({ ip: "9.9.9.9", displayName: "x" + i, kind: "human_agent" });
    assert.ok(result.api_key);
  }
  try {
    await bs.createTenantAndFirstKey({ ip: "9.9.9.9", displayName: "x6", kind: "human_agent" });
    assert.fail("6th attempt should have been rate-limited");
  } catch (err) {
    assert.equal(err.code, "rate_limited");
    assert.equal(err.status, 429);
    assert.ok(err.retryAfterMinutes >= 1);
  }
});

test("createBootstrap issues a key with alk_ prefix and 12-char public prefix", async () => {
  const { tenantService, userService, registry } = await makeServicesWithRegistry();
  const bs = createBootstrap({
    tenantService, userService,
    rateLimiter: createRateLimiter({ registry }),
    schemaProvisioner: MOCK_PROVISIONER,
    sharedUrl: "postgres://localhost/alfred_saas"
  });
  const result = await bs.createTenantAndFirstKey({ ip: "5.5.5.5", displayName: "alpha", kind: "hybrid_with_human" });
  assert.ok(result.api_key.startsWith("alk_"));
  assert.equal(result.key_prefix.length, 12);
  assert.match(result.key_prefix, /^alk_[A-Za-z0-9_-]{8}$/);
});

test("schema provisioner builds tenant_<id> schema and search_path connection", async () => {
  const provisioner = createSchemaProvisioner({ pgClient: async () => ({ query: async () => {}, end: async () => {} }) });
  const schema = provisioner.schemaNameFor("usr_t_abc123abc123abc123abc123abc12345");
  assert.equal(schema, "tenant_abc123abc123abc123abc123abc12345");
  const conn = provisioner.buildTenantConnectionString("postgres://u:p@h/d", schema);
  assert.ok(/search_path[=%]3[Dd]tenant_/.test(conn) || /search_path=tenant_/.test(decodeURIComponent(conn)), "expected search_path=tenant_ in " + conn);
});

test("schema provisioner rejects invalid tenant ids", async () => {
  const provisioner = createSchemaProvisioner({ pgClient: async () => ({}) });
  assert.throws(() => provisioner.schemaNameFor("not_a_real_id"));
  assert.throws(() => provisioner.schemaNameFor("usr_t_zzz"));
  assert.throws(() => provisioner.schemaNameFor(""));
});

test("schema provisioner requires a pgClient function", () => {
  assert.throws(() => createSchemaProvisioner({}));
  assert.throws(() => createSchemaProvisioner({ pgClient: "not a function" }));
});

test("rate limiter allows 5 attempts and blocks the 6th", async () => {
  const { registry } = await makeServicesWithRegistry();
  const rl = createRateLimiter({ registry });
  for (let i = 0; i < 5; i += 1) {
    const check = await rl.check({ ip: "1.1.1.1" });
    assert.equal(check.allowed, true, "attempt " + i + " should be allowed");
    await rl.record({ ip: "1.1.1.1", displayName: "x", kind: "human_agent", result: "success" });
  }
  const blocked = await rl.check({ ip: "1.1.1.1" });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "rate_limited");
  assert.ok(blocked.retryAfterMinutes >= 1);
});

test("rate limiter counts only the specified IP", async () => {
  const { registry } = await makeServicesWithRegistry();
  const rl = createRateLimiter({ registry });
  for (let i = 0; i < 5; i += 1) {
    await rl.record({ ip: "1.1.1.1", displayName: "x", kind: "human_agent", result: "success" });
  }
  const other = await rl.check({ ip: "2.2.2.2" });
  assert.equal(other.allowed, true);
});

test("rate limiter rejects unknown result", async () => {
  const { registry } = await makeServicesWithRegistry();
  const rl = createRateLimiter({ registry });
  await assert.rejects(rl.record({ ip: "1.1.1.1", result: "made_up_result" }), /Invalid result/);
});

test("POST /console/api/bootstrap without registry returns 503 saas_not_configured", async () => {
  const { createInMemoryTenantStore, createInMemoryUserStore, createTenantService, createUserService } = await import("../../memory/src/index.js");
  const tenantService = createTenantService({ store: createInMemoryTenantStore() });
  const userService = createUserService({ store: createInMemoryUserStore() });
  const router = createConsoleRouter({
    userService, tenantService, config: {}, consoleDirOverride: "",
    sharedUrl: "postgres://localhost/alfred_saas"
  });
  const res = await invoke(router, makeReq({
    method: "POST", url: "/console/api/bootstrap", body: { display_name: "x", kind: "human_agent" }
  }));
  assert.equal(res.statusCode, 503);
  const body = JSON.parse(res.body);
  assert.equal(body.error.code, "saas_not_configured");
});

test("console-web index.html contains the signup form and the bootstrap endpoint", () => {
  const htmlPath = "/Users/josegilbertoolivasibarra/Documents/personal/workspace/alfred/packages/console-web/src/index.html";
  const htmlText = readFileSync(htmlPath, "utf8");
  assert.match(htmlText, /signup\(\)/);
  assert.match(htmlText, /\/console\/api\/bootstrap/);
  assert.match(htmlText, /display_name/);
  assert.match(htmlText, /human_agent/);
  assert.match(htmlText, /hybrid_with_human/);
  assert.match(htmlText, /No terminal\? No problem\./);
});


// ============================================================================
// v0.4.0 phase 25: CAPTCHA (Cloudflare Turnstile)
// ============================================================================
//
// Tests the captcha verifier and the integration with createBootstrap.
// All tests use a mock fetch; the verifier does NOT make real HTTP calls.

import { createCaptchaVerifier } from "../src/bootstrap/index.js";

test("createCaptchaVerifier is disabled when no keys are set", () => {
  const v = createCaptchaVerifier({ siteKey: null, secretKey: null });
  assert.equal(v.isEnabled(), false);
  assert.equal(v.siteKey(), null);
});

test("createCaptchaVerifier is enabled when both keys are set", () => {
  const v = createCaptchaVerifier({ siteKey: "site_abc", secretKey: "secret_xyz" });
  assert.equal(v.isEnabled(), true);
  assert.equal(v.siteKey(), "site_abc");
});

test("captcha verify skipped when disabled", async () => {
  const v = createCaptchaVerifier({ siteKey: null, secretKey: null });
  const r = await v.verify({ token: "anything" });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, true);
});

test("captcha verify rejects missing token when enabled", async () => {
  const v = createCaptchaVerifier({ siteKey: "site_abc", secretKey: "secret_xyz", fetchImpl: async () => ({ ok: true, json: async () => ({ success: true }) }) });
  const r = await v.verify({ token: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error_code, "missing_token");
});

test("captcha verify accepts valid token from siteverify", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ success: true, challenge_ts: "2026-01-01T00:00:00Z", hostname: "example.com" }) });
  const v = createCaptchaVerifier({ siteKey: "site_abc", secretKey: "secret_xyz", fetchImpl });
  const r = await v.verify({ token: "valid_token_123" });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, false);
  assert.ok(r.verified_at);
});

test("captcha verify rejects invalid token from siteverify", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }) });
  const v = createCaptchaVerifier({ siteKey: "site_abc", secretKey: "secret_xyz", fetchImpl });
  const r = await v.verify({ token: "bad_token" });
  assert.equal(r.ok, false);
  assert.equal(r.error_code, "invalid-input-response");
});

test("captcha verify returns error when siteverify is unreachable", async () => {
  const fetchImpl = async () => { throw new Error("ECONNREFUSED"); };
  const v = createCaptchaVerifier({ siteKey: "site_abc", secretKey: "secret_xyz", fetchImpl });
  const r = await v.verify({ token: "x" });
  assert.equal(r.ok, false);
  assert.equal(r.error_code, "siteverify_unreachable");
});

test("captcha verify sends secret + response + remoteip to siteverify", async () => {
  let capturedBody = null;
  let capturedUrl = null;
  const fetchImpl = async (url, init) => {
    capturedUrl = url;
    capturedBody = init.body;
    return { ok: true, json: async () => ({ success: true }) };
  };
  const v = createCaptchaVerifier({ siteKey: "site_abc", secretKey: "secret_xyz", fetchImpl });
  await v.verify({ token: "tok_123", remoteIp: "1.2.3.4" });
  assert.match(capturedUrl, /turnstile.*siteverify/);
  assert.match(capturedBody, /secret=secret_xyz/);
  assert.match(capturedBody, /response=tok_123/);
  assert.match(capturedBody, /remoteip=1\.2\.3\.4/);
});

test("createBootstrap rejects when captchaVerifier rejects", async () => {
  const { tenantService, userService, registry } = await makeServicesWithRegistry();
  const captchaVerifier = {
    isEnabled() { return true; },
    async verify() { return { ok: false, error_code: "invalid-input-response", message: "bad" }; }
  };
  const bs = createBootstrap({
    tenantService, userService,
    rateLimiter: createRateLimiter({ registry }),
    schemaProvisioner: MOCK_PROVISIONER,
    sharedUrl: "postgres://localhost/alfred_saas",
    captchaVerifier
  });
  try {
    await bs.createTenantAndFirstKey({ ip: "1.2.3.4", displayName: "x", kind: "human_agent", turnstileToken: "bad" });
    assert.fail("should have thrown");
  } catch (err) {
    assert.equal(err.code, "validation_error");
    assert.ok(err.details.find((d) => d.field === "turnstile_token"));
  }
});

test("createBootstrap accepts valid captcha token", async () => {
  const { tenantService, userService, registry } = await makeServicesWithRegistry();
  const captchaVerifier = {
    isEnabled() { return true; },
    async verify() { return { ok: true }; }
  };
  const bs = createBootstrap({
    tenantService, userService,
    rateLimiter: createRateLimiter({ registry }),
    schemaProvisioner: MOCK_PROVISIONER,
    sharedUrl: "postgres://localhost/alfred_saas",
    captchaVerifier
  });
  const result = await bs.createTenantAndFirstKey({ ip: "8.8.8.8", displayName: "x", kind: "human_agent", turnstileToken: "good" });
  assert.ok(result.api_key);
});

test("createBootstrap skips captcha when verifier is null (backward compat)", async () => {
  const { tenantService, userService, registry } = await makeServicesWithRegistry();
  const bs = createBootstrap({
    tenantService, userService,
    rateLimiter: createRateLimiter({ registry }),
    schemaProvisioner: MOCK_PROVISIONER,
    sharedUrl: "postgres://localhost/alfred_saas"
    // captchaVerifier omitted -> backward compat
  });
  const result = await bs.createTenantAndFirstKey({ ip: "7.7.7.7", displayName: "x", kind: "human_agent" });
  assert.ok(result.api_key);
});

test("console-web index.html includes the Turnstile widget and site key wiring", () => {
  const htmlPath = "/Users/josegilbertoolivasibarra/Documents/personal/workspace/alfred/packages/console-web/src/index.html";
  const htmlText = readFileSync(htmlPath, "utf8");
  assert.match(htmlText, /renderTurnstile/);
  assert.match(htmlText, /ALFRED_TURNSTILE_SITE_KEY/);
  assert.match(htmlText, /turnstileContainer/);
  assert.match(htmlText, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/);
});


// ============================================================================
// v0.4.0 phase 26: Email verification
// ============================================================================

import { createEmailSender, createVerification } from "../src/bootstrap/index.js";

test("createEmailSender is disabled when ALFRED_SMTP_HOST is unset", () => {
  const s = createEmailSender({ host: null });
  assert.equal(s.isEnabled(), false);
});

test("createEmailSender is enabled when ALFRED_SMTP_HOST is set", () => {
  const s = createEmailSender({ host: "smtp.example.com" });
  assert.equal(s.isEnabled(), true);
});

test("createEmailSender validates email format", () => {
  const s = createEmailSender({ host: null });
  assert.equal(s.isValidEmail("user@example.com"), true);
  assert.equal(s.isValidEmail("not-an-email"), false);
  assert.equal(s.isValidEmail(""), false);
  assert.equal(s.isValidEmail(null), false);
  assert.equal(s.isValidEmail("a@b.c"), true);
});

test("createEmailSender.send is a no-op when disabled but logs the would-be send", async () => {
  let logged = null;
  const s = createEmailSender({ host: null, log: { warn: (msg) => { logged = msg; } } });
  const r = await s.send({ to: "u@example.com", subject: "x", text: "hello" });
  assert.equal(r.sent, false);
  assert.equal(r.skipped, true);
  assert.match(logged, /u@example.com/);
});

test("createEmailSender rejects invalid recipient", async () => {
  const s = createEmailSender({ host: "smtp.example.com" });
  const r = await s.send({ to: "not-an-email", subject: "x", text: "y" });
  assert.equal(r.sent, false);
  assert.equal(r.error, "invalid_recipient");
});

test("createEmailSender.generateToken returns a 32-char base64url string", () => {
  const s = createEmailSender({ host: null });
  const t = s.generateToken();
  assert.equal(typeof t, "string");
  assert.equal(t.length, 32);
  assert.match(t, /^[A-Za-z0-9_-]+$/);
});

test("createVerification rejects invalid email", async () => {
  const registry = { emailVerifications: { createEmailVerification: async () => ({ id: "x" }) } };
  const sender = createEmailSender({ host: null });
  const v = createVerification({ registry, emailSender: sender });
  const r = await v.createVerification({ tenant_id: "usr_t_abc", email: "not-an-email" });
  assert.equal(r.sent, false);
  assert.equal(r.error, "invalid_email");
});

test("createVerification creates a row and returns a link", async () => {
  let storedRow = null;
  const registry = { emailVerifications: { createEmailVerification: async (input) => { storedRow = input; return { id: "x" }; } } };
  const sender = createEmailSender({ host: null });
  const v = createVerification({ registry, emailSender: sender, baseUrl: "https://alfred.example.com" });
  const r = await v.createVerification({ tenant_id: "usr_t_abc", email: "user@example.com" });
  assert.equal(r.sent, false);
  assert.equal(r.skipped, true);
  assert.ok(storedRow);
  assert.equal(storedRow.email, "user@example.com");
  assert.ok(r.link.startsWith("https://alfred.example.com/console/api/verify?token="));
});

test("createVerification.consumeVerification returns null for unknown token", async () => {
  const registry = { emailVerifications: { findEmailVerificationByToken: async () => null, markEmailVerificationUsed: async () => {} } };
  const sender = createEmailSender({ host: null });
  const v = createVerification({ registry, emailSender: sender });
  const result = await v.consumeVerification("nonexistent");
  assert.equal(result, null);
});

test("createVerification.consumeVerification returns null for already-used token", async () => {
  const registry = {
    emailVerifications: {
      findEmailVerificationByToken: async () => ({ id: "v1", tenant_id: "usr_t_abc", email: "u@x", token: "t", expires_at: new Date(Date.now() + 1e6).toISOString(), used_at: new Date().toISOString() }),
      markEmailVerificationUsed: async () => {}
    }
  };
  const sender = createEmailSender({ host: null });
  const v = createVerification({ registry, emailSender: sender });
  const result = await v.consumeVerification("t");
  assert.equal(result, null);
});

test("createVerification.consumeVerification marks expired tokens", async () => {
  const registry = {
    emailVerifications: {
      findEmailVerificationByToken: async () => ({ id: "v1", tenant_id: "usr_t_abc", email: "u@x", token: "t", expires_at: new Date(Date.now() - 1000).toISOString(), used_at: null }),
      markEmailVerificationUsed: async () => {}
    }
  };
  const sender = createEmailSender({ host: null });
  const v = createVerification({ registry, emailSender: sender });
  const result = await v.consumeVerification("t");
  assert.equal(result.expired, true);
  assert.equal(result.tenant_id, "usr_t_abc");
});

test("createVerification.consumeVerification returns tenant_id on success", async () => {
  let markedUsed = false;
  const registry = {
    emailVerifications: {
      findEmailVerificationByToken: async () => ({ id: "v1", tenant_id: "usr_t_abc", email: "u@x", token: "t", expires_at: new Date(Date.now() + 1e6).toISOString(), used_at: null }),
      markEmailVerificationUsed: async () => { markedUsed = true; }
    }
  };
  const sender = createEmailSender({ host: null });
  const v = createVerification({ registry, emailSender: sender });
  const result = await v.consumeVerification("t");
  assert.equal(result.tenant_id, "usr_t_abc");
  assert.equal(result.email, "u@x");
  assert.ok(result.verified_at);
  assert.equal(markedUsed, true);
});

test("createBootstrap with valid email returns email_verification metadata", async () => {
  const { tenantService, userService, registry } = await makeServicesWithRegistry();
  const sender = createEmailSender({ host: null });
  const verification = createVerification({ registry, emailSender: sender, baseUrl: "https://x" });
  const bs = createBootstrap({
    tenantService, userService,
    rateLimiter: createRateLimiter({ registry }),
    schemaProvisioner: MOCK_PROVISIONER,
    sharedUrl: "postgres://localhost/alfred_saas",
    verification
  });
  const result = await bs.createTenantAndFirstKey({ ip: "1.2.3.4", displayName: "x", kind: "human_agent", email: "user@example.com" });
  assert.ok(result.email_verification);
  assert.equal(result.email_verification.sent, false);
  assert.equal(result.email_verification.skipped, true);
  assert.ok(result.email_verification.link);
});

test("createBootstrap rejects invalid email with validation_error", async () => {
  const { tenantService, userService, registry } = await makeServicesWithRegistry();
  const sender = createEmailSender({ host: null });
  const verification = createVerification({ registry, emailSender: sender });
  const bs = createBootstrap({
    tenantService, userService,
    rateLimiter: createRateLimiter({ registry }),
    schemaProvisioner: MOCK_PROVISIONER,
    sharedUrl: "postgres://localhost/alfred_saas",
    verification
  });
  try {
    await bs.createTenantAndFirstKey({ ip: "1.2.3.4", displayName: "x", kind: "human_agent", email: "not-an-email" });
    assert.fail("should have thrown");
  } catch (err) {
    assert.equal(err.code, "validation_error");
    assert.ok(err.details.find((d) => d.field === "email"));
  }
});

test("console-web index.html includes the email field in the signup form", () => {
  const htmlPath = "/Users/josegilbertoolivasibarra/Documents/personal/workspace/alfred/packages/console-web/src/index.html";
  const htmlText = readFileSync(htmlPath, "utf8");
  assert.match(htmlText, /signupEmail/);
  assert.match(htmlText, /email.*optional.*key recovery/);
});


// ============================================================================
// v0.4.0 phase 27: CI Postgres isolation test (file presence + format)
// ============================================================================
//
// We do not run the real-Postgres test here; it is opt-in via
// ALFRED_TEST_POSTGRES_URL and runs in CI only. We just verify the
// test file exists, references the env var, and uses pg.

test("ci-postgres.yml exists and runs the isolation test", () => {
  const wf = "/Users/josegilbertoolivasibarra/Documents/personal/workspace/alfred/.github/workflows/ci-postgres.yml";
  const t = readFileSync(wf, "utf8");
  assert.match(t, /cross-tenant-isolation-postgres\.test\.mjs/);
  assert.match(t, /postgres:16-alpine/);
  assert.match(t, /ALFRED_TEST_POSTGRES_URL/);
});

test("cross-tenant-isolation-postgres test file exists and is opt-in", () => {
  const t = "/Users/josegilbertoolivasibarra/Documents/personal/workspace/alfred/packages/memory-server/test/cross-tenant-isolation-postgres.test.mjs";
  const src = readFileSync(t, "utf8");
  assert.match(src, /ALFRED_TEST_POSTGRES_URL/);
  assert.match(src, /skip: SHOULD_RUN/);
  assert.match(src, /import\("pg"\)/);
});


// ============================================================================
// v0.4.0 phase 28: Forgot-my-key recovery
// ============================================================================

import { createRecovery, RecoveryRateLimitedError, RecoveryValidationError } from "../src/bootstrap/index.js";

function makeRecoveryFixture() {
  const emails = [];
  let tenantCounter = 0;
  const store = {
    findTenantByEmail: async () => null,
    _recoveryArr: [],
    verifications: [],
    recoveries: [],
    keys: new Map(), // keyId -> { id, tenant_id, revoked_at, key_prefix }
    async findLatestVerificationForEmail(email) {
      return this.verifications.find((v) => v.email === email) ?? null;
    },
    async createRecovery(input) { this.recoveries.push(input); return { id: "rec_" + input.token.slice(0,8) }; },
    async findRecoveryByToken(token) { return this.recoveries.find((r) => r.token === token) ?? null; },
    async markRecoveryUsed(id, payload) {
      const r = this.recoveries.find((x) => x.id === id);
      if (r) Object.assign(r, { used_at: new Date().toISOString() }, payload);
    },
    async findActiveKeyForTenant(tenantId) {
      const list = [...this.keys.values()].filter((k) => k.tenant_id === tenantId && !k.revoked_at);
      return list[0] ?? null;
    },
    async revokeApiKey(keyId) {
      const k = this.keys.get(keyId);
      if (k) k.revoked_at = new Date().toISOString();
    }
  };
  // Wrap methods in a `recoveries` sub-object so registry.recoveries.X works.
  // The wrapped methods operate on store.recoveries (the array).
  store.recoveries = {
    findLatestVerificationForEmail: (email) => store.verifications.find((v) => v.email === email) ?? null,
    createRecovery: (input) => { store._recoveryArr.push(input); return { id: "rec_" + input.token.slice(0,8) }; },
    findRecoveryByToken: (token) => store._recoveryArr.find((r) => r.token === token) ?? null,
    markRecoveryUsed: (id, payload) => {
      const r = store._recoveryArr.find((x) => x.id === id);
      if (r) Object.assign(r, { used_at: new Date().toISOString() }, payload);
    },
    findActiveKeyForTenant: (tenantId) => {
      const list = [...store.keys.values()].filter((k) => k.tenant_id === tenantId && !k.revoked_at);
      return list[0] ?? null;
    },
    revokeApiKey: (keyId) => {
      const k = store.keys.get(keyId);
      if (k) k.revoked_at = new Date().toISOString();
    }
  };
  return { store, emails, tenantCounter, keys: store.keys, verifications: store.verifications, recoveries: store.recoveries };
}

test("createRecovery requires registry + userService + emailSender", () => {
  assert.throws(() => createRecovery({}));
  // Providing a non-emailSender that is null should still throw.
  assert.throws(() => createRecovery({ registry: {}, userService: {} }));
});

test("createRecovery.requestRecovery rejects invalid email with validation_error", async () => {
  const fx = makeRecoveryFixture();
  const sender = createEmailSender({ host: null });
  const r = createRecovery({ registry: fx.store, userService: { provisionApiKey: async () => ({ apiKey: "x", key: { id: "k" } }) }, emailSender: sender });
  try {
    await r.requestRecovery({ ip: "1.1.1.1", email: "bad" });
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof RecoveryValidationError);
    assert.equal(err.code, "validation_error");
  }
});

test("createRecovery.requestRecovery returns generic 200-like result when email not registered (no enumeration)", async () => {
  const fx = makeRecoveryFixture();
  const sender = createEmailSender({ host: null });
  const r = createRecovery({ registry: fx.store, userService: { provisionApiKey: async () => ({ apiKey: "x", key: { id: "k" } }) }, emailSender: sender });
  const result = await r.requestRecovery({ ip: "1.1.1.1", email: "unknown@example.com" });
  assert.equal(result.sent, false);
  assert.equal(result.skipped, true);
});

test("createRecovery.requestRecovery issues a token and sends a link when email is registered", async () => {
  const fx = makeRecoveryFixture();
  fx.store.verifications.push({ id: "v1", tenant_id: "usr_t_abc", email: "user@example.com" });
  let sent = null;
  const sender = {
    isValidEmail: () => true,
    generateToken: () => "tok_recovery_12345678",
    send: async (msg) => { sent = msg; return { sent: false, skipped: true }; }
  };
  const r = createRecovery({ registry: fx.store, userService: {}, emailSender: sender, baseUrl: "https://x" });
  const result = await r.requestRecovery({ ip: "1.1.1.1", email: "user@example.com" });
  assert.equal(fx.store._recoveryArr.length, 1);
  assert.equal(fx.store._recoveryArr[0].tenant_id, "usr_t_abc");
  assert.equal(sent.to, "user@example.com");
  assert.match(sent.text, /tok_recovery_12345678/);
  assert.equal(result.link.startsWith("https://x/console/api/recover?token="), true);
});

test("createRecovery rate limits after 3 attempts in the window", async () => {
  const fx = makeRecoveryFixture();
  fx.store.verifications.push({ id: "v1", tenant_id: "usr_t_abc", email: "user@example.com" });
  const sender = { isValidEmail: () => true, generateToken: () => "tok", send: async () => ({ sent: false, skipped: true }) };
  const r = createRecovery({ registry: fx.store, userService: {}, emailSender: sender });
  for (let i = 0; i < 3; i += 1) {
    await r.requestRecovery({ ip: "9.9.9.9", email: "user@example.com" });
  }
  try {
    await r.requestRecovery({ ip: "9.9.9.9", email: "user@example.com" });
    assert.fail("4th attempt should have been rate-limited");
  } catch (err) {
    assert.ok(err instanceof RecoveryRateLimitedError);
    assert.equal(err.code, "rate_limited");
    assert.ok(err.retryAfterMinutes >= 1);
  }
});

test("createRecovery.consumeRecovery returns null for unknown token", async () => {
  const fx = makeRecoveryFixture();
  const sender = createEmailSender({ host: null });
  const r = createRecovery({ registry: fx.store, userService: {}, emailSender: sender });
  assert.equal(await r.consumeRecovery({ token: "nope" }), null);
});

test("createRecovery.consumeRecovery revokes old key, issues new, marks used", async () => {
  const fx = makeRecoveryFixture();
  // Tenant with an active key.
  fx.store.keys.set("key_old", { id: "key_old", tenant_id: "usr_t_abc", revoked_at: null, key_prefix: "alk_oldxxx" });
  // Recovery row.
  fx.store._recoveryArr.push({ id: "rec1", tenant_id: "usr_t_abc", email: "u@x.com", token: "tok1", expires_at: new Date(Date.now() + 1e6).toISOString(), used_at: null });
  const sender = createEmailSender({ host: null });
  const userService = {
    async provisionApiKey({ tenant_id, label }) {
      return { apiKey: "alk_new_key", key: { id: "key_new", key_prefix: "alk_newxxxx", label } };
    }
  };
  const r = createRecovery({ registry: fx.store, userService, emailSender: sender });
  const result = await r.consumeRecovery({ token: "tok1" });
  assert.equal(result.tenant_id, "usr_t_abc");
  assert.equal(result.api_key, "alk_new_key");
  assert.equal(result.old_key_id, "key_old");
  assert.equal(result.key_id, "key_new");
  assert.ok(fx.store.keys.get("key_old").revoked_at, "old key should be revoked");
  assert.ok(fx.store._recoveryArr[0].used_at, "recovery should be marked used");
});

test("createRecovery.consumeRecovery returns null for already-used token", async () => {
  const fx = makeRecoveryFixture();
  fx.store._recoveryArr.push({ id: "rec1", tenant_id: "usr_t_abc", email: "u@x.com", token: "tok1", expires_at: new Date(Date.now() + 1e6).toISOString(), used_at: new Date().toISOString() });
  const sender = createEmailSender({ host: null });
  const r = createRecovery({ registry: fx.store, userService: {}, emailSender: sender });
  assert.equal(await r.consumeRecovery({ token: "tok1" }), null);
});

test("createRecovery.consumeRecovery marks expired tokens", async () => {
  const fx = makeRecoveryFixture();
  fx.store._recoveryArr.push({ id: "rec1", tenant_id: "usr_t_abc", email: "u@x.com", token: "tok1", expires_at: new Date(Date.now() - 1000).toISOString(), used_at: null });
  const sender = createEmailSender({ host: null });
  const r = createRecovery({ registry: fx.store, userService: {}, emailSender: sender });
  const result = await r.consumeRecovery({ token: "tok1" });
  assert.equal(result.expired, true);
});

test("console-web index.html includes the forgot-my-key panel", () => {
  const htmlPath = "/Users/josegilbertoolivasibarra/Documents/personal/workspace/alfred/packages/console-web/src/index.html";
  const htmlText = readFileSync(htmlPath, "utf8");
  assert.match(htmlText, /requestRecovery/);
  assert.match(htmlText, /recoverEmail/);
  assert.match(htmlText, /Forgot your API key\?/);
});


// ============================================================================
// v0.4.0 phase 29: Embedding-based semantic search
// ============================================================================

import {
  createEmbedder,
  createSearchService,
  rankBySemanticScore,
  reciprocalRankFusion,
  cosineSimilarity,
  embeddingToBuffer,
  bufferToEmbedding
} from "../src/bootstrap/index.js";

test("cosineSimilarity returns 1 for identical L2-normalized vectors", () => {
  const a = new Float32Array([1, 0, 0]);
  const b = new Float32Array([1, 0, 0]);
  assert.equal(cosineSimilarity(a, b), 1);
});

test("cosineSimilarity returns 0 for orthogonal vectors", () => {
  const a = new Float32Array([1, 0, 0]);
  const b = new Float32Array([0, 1, 0]);
  assert.equal(cosineSimilarity(a, b), 0);
});

test("cosineSimilarity throws on dimension mismatch", () => {
  const a = new Float32Array([1, 0, 0]);
  const b = new Float32Array([1, 0]);
  assert.throws(() => cosineSimilarity(a, b), /dimension mismatch/);
});

test("embeddingToBuffer + bufferToEmbedding roundtrips", () => {
  const a = new Float32Array([0.1, 0.2, 0.3, 0.4]);
  const buf = embeddingToBuffer(a);
  assert.ok(Buffer.isBuffer(buf));
  const b = bufferToEmbedding(buf);
  assert.equal(b.length, 4);
  for (let i = 0; i < a.length; i += 1) assert.equal(b[i], a[i]);
});

test("rankBySemanticScore returns top-K by score", () => {
  const q = new Float32Array([1, 0, 0]);
  const candidates = [
    { id: "a", embedding: new Float32Array([1, 0, 0]), payload: { id: "a", text: "exact" } },
    { id: "b", embedding: new Float32Array([0.5, 0.5, 0]), payload: { id: "b", text: "half" } },
    { id: "c", embedding: new Float32Array([0, 1, 0]), payload: { id: "c", text: "orthogonal" } }
  ];
  const ranked = rankBySemanticScore({ queryEmbedding: q, candidates, topK: 2 });
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].id, "a");
  assert.equal(ranked[1].id, "b");
});

test("reciprocalRankFusion combines two lists, prefers items in both", () => {
  const sem = [
    { id: "x", score: 0.9, payload: {} },
    { id: "y", score: 0.7, payload: {} }
  ];
  const kw = [
    { id: "y", score: 1, payload: {} },
    { id: "z", score: 0.5, payload: {} }
  ];
  const fused = reciprocalRankFusion({ semanticRanking: sem, keywordRanking: kw });
  assert.equal(fused[0].id, "y", "y is in both lists, should rank first");
});

test("createEmbedder without model deps returns null embed on unavailable", async () => {
  const e = createEmbedder({ transformersModule: null });
  // Without a real transformers module, the embed call should return null
  // (and isAvailable() should report false after the failed load).
  const r = await e.embed("test");
  assert.equal(r, null);
  assert.equal(e.isAvailable(), false);
});

test("createSearchService.search with unavailable embedder falls back to keyword", async () => {
  const e = createEmbedder({ transformersModule: null });
  const embeddingStore = { upsert: async () => {}, getByTenant: async () => [] };
  const keywordSearch = async ({ query, limit }) => [
    { id: "k1", content: "match for " + query },
    { id: "k2", content: "another " + query }
  ];
  const svc = createSearchService({ embedder: e, embeddingStore, keywordSearch });
  // Even in hybrid mode, when embedder is unavailable, only keyword results return.
  const r = await svc.search({ tenantId: "usr_t_abc", query: "hello", mode: "hybrid", limit: 10 });
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].id, "k1");
});

test("createSearchService.search with mock embedder returns hybrid results", async () => {
  // Mock embedder: returns a vector for "hello" that matches candidate "k1" exactly.
  const mockEmbeddings = {
    "hello": new Float32Array([1, 0, 0]),
    "world": new Float32Array([0, 1, 0])
  };
  const e = {
    modelName: "mock",
    dim: 3,
    isAvailable() { return true; },
    async embed(text) { return mockEmbeddings[text] ?? new Float32Array([0, 0, 1]); }
  };
  const embeddingStore = {
    async upsert(input) { this._store = this._store ?? new Map(); this._store.set(input.memory_id, input); },
    async getByTenant(tenantId) {
      this._store = this._store ?? new Map();
      return [...this._store.values()].filter((e) => e.tenant_id === tenantId).map((e) => ({
        id: e.memory_id,
        embedding: bufferToEmbedding(e.embedding),
        payload: { id: e.memory_id, content: "stored" }
      }));
    }
  };
  const keywordSearch = async ({ query, limit }) => [
    { id: "k1", content: "match for " + query },
    { id: "k2", content: "another " + query }
  ];
  const svc = createSearchService({ embedder: e, embeddingStore, keywordSearch });
  // First index a memory with embedding [1,0,0] (matches "hello" exactly).
  await svc.index({ memoryId: "m1", tenantId: "usr_t_abc", content: "hello" });
  // Now search for "hello" in hybrid mode.
  const r = await svc.search({ tenantId: "usr_t_abc", query: "hello", mode: "hybrid", limit: 10 });
  assert.ok(r.items.length > 0);
});

test("createSearchService requires embeddingStore and keywordSearch", () => {
  assert.throws(() => createSearchService({}));
});
