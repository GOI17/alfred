import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { createMemoryService, createInMemoryStore, createTenantService, createInMemoryTenantStore, createUserService, createInMemoryUserStore } from "../../memory/src/index.js";
import { createAgentActivity } from "../src/agent-activity.js";
import { createConsoleRouter } from "../src/console-router.js";
import { createOpenapiRouter } from "../src/openapi-router.js";
import { createMcpRouter } from "../src/mcp-router.js";
import { createApp } from "../src/server.js";

async function fixture() {
  let time = Date.parse("2026-09-08T00:00:00Z");
  const tenantService = createTenantService({ store: createInMemoryTenantStore() });
  const users = createInMemoryUserStore();
  const userService = createUserService({ store: users });
  const credentials = [];
  for (const name of ["one", "two"]) {
    const tenant = await tenantService.provisionTenant({ display_name: name, kind: "coding_agent_only", storage_backend: "sqlite", db_path: "/unused.sqlite" });
    await users.addTenantStub(tenant);
    credentials.push({ tenant, ...await userService.provisionApiKey({ tenant_id: tenant.id, label: '<img src=x onerror="bad()">' }) });
  }
  const memories = [
    { id: "a", userId: credentials[0].tenant.id, type: "fact", namespace: "project:alpha", projectId: "alpha", content: "Older tie", source: "test", tags: ["tag"], createdAt: new Date(time).toISOString() },
    { id: "b", userId: credentials[0].tenant.id, type: "fact", namespace: "project:alpha", projectId: "alpha", content: '<script>bad()</script>', source: "test", tags: ["tag"], createdAt: new Date(time).toISOString() },
    { id: "c", userId: credentials[0].tenant.id, type: "decision", namespace: "personal", content: "Personal", tags: [], createdAt: new Date(time + 1).toISOString() },
    { id: "private", userId: credentials[1].tenant.id, type: "fact", namespace: "project:alpha", projectId: "alpha", content: "OTHER TENANT", tags: [], createdAt: new Date(time + 2).toISOString() }
  ];
  const memoryService = createMemoryService({ store: createInMemoryStore(memories) });
  const agentActivity = createAgentActivity({ now: () => time });
  const options = { userService, tenantService, getMemoryService: async () => memoryService, agentActivity, config: { requireAuth: true } };
  return { ...options, credentials, memoryService, advance: (ms) => { time += ms; }, router: createConsoleRouter(options) };
}
function request(url, apiKey, method = "GET") {
  return Object.assign(new EventEmitter(), { url, method, headers: apiKey ? { authorization: "Bearer " + apiKey } : {}, async *[Symbol.asyncIterator]() {} });
}
function response() {
  return Object.assign(new EventEmitter(), { statusCode: 200, headers: {}, body: "", writableEnded: false,
    setHeader(key, value) { this.headers[key] = value; },
    writeHead(status, headers = {}) { this.statusCode = status; Object.assign(this.headers, headers); },
    end(body = "") { this.body += body; this.writableEnded = true; this.emit("finish"); this.emit("close"); }
  });
}
async function invoke(handler, req) { const res = response(); await handler(req, res); return res; }
function path(fx, section, index = 0) { return "/console/api/tenants/" + fx.credentials[index].tenant.id + "/" + section; }

test("history preserves stable chronological pages, actual metadata and tenant/project filters", async () => {
  const fx = await fixture(); const key = fx.credentials[0].apiKey;
  const first = await invoke(fx.router, request(path(fx, "memories") + "?limit=2&tenant_id=" + fx.credentials[1].tenant.id, key));
  assert.equal(first.statusCode, 200); assert.equal(first.headers["cache-control"], "no-store");
  const body = JSON.parse(first.body);
  assert.deepEqual(body.items.map((m) => m.id), ["c", "b"]); assert.equal(body.pagination.total, 3);
  assert.equal(body.items[1].content, '<script>bad()</script>'); assert.equal(body.items[1].source, "test");
  const next = await invoke(fx.router, request(path(fx, "memories") + "?limit=2&offset=2", key));
  assert.deepEqual(JSON.parse(next.body).items.map((m) => m.id), ["a"]);
  const filtered = await invoke(fx.router, request(path(fx, "memories") + "?namespace=project:alpha&projectId=alpha&type=fact&tag=tag", key));
  assert.deepEqual(JSON.parse(filtered.body).items.map((m) => m.id), ["b", "a"]);
  const empty = await invoke(fx.router, request(path(fx, "memories") + "?projectId=missing", key));
  assert.equal(JSON.parse(empty.body).pagination.total, 0);
  assert.doesNotMatch(first.body + next.body + filtered.body, /OTHER TENANT/);
});

test("dashboard authentication, method and validation errors fail closed without exception disclosure", async () => {
  const fx = await fixture(); const key = fx.credentials[0].apiKey;
  for (const section of ["memories", "agents"]) {
    assert.equal((await invoke(fx.router, request(path(fx, section)))).statusCode, 401);
    assert.equal((await invoke(fx.router, request(path(fx, section), "alk_invalid"))).statusCode, 401);
    assert.equal((await invoke(fx.router, request(path(fx, section, 1), key))).statusCode, 404);
    assert.equal((await invoke(fx.router, request(path(fx, section), key, "POST"))).statusCode, 405);
    for (const overrides of [
      { userService: { async resolveApiKey() { throw new Error("SECRET_DATABASE_URL"); } } },
      section === "memories" ? { async getMemoryService() { throw new Error("SECRET_DATABASE_URL"); } } : { agentActivity: { list() { throw new Error("SECRET_DATABASE_URL"); } } }
    ]) {
      const res = await invoke(createConsoleRouter({ ...fx, ...overrides }), request(path(fx, section), key));
      assert.equal(res.statusCode, 503); assert.doesNotMatch(res.body, /SECRET_DATABASE_URL/); assert.equal(res.headers["cache-control"], "no-store");
    }
  }
  for (const query of ["limit=101", "offset=-1", "type=invalid", "namespace=invalid%20namespace"]) {
    assert.equal((await invoke(fx.router, request(path(fx, "memories") + "?" + query, key))).statusCode, 400);
  }
});

test("registered credentials and console polling do not fabricate presence; revocation overrides observation", async () => {
  const fx = await fixture(); const own = fx.credentials[0];
  await invoke(fx.router, request(path(fx, "memories"), own.apiKey));
  assert.deepEqual(JSON.parse((await invoke(fx.router, request(path(fx, "agents"), own.apiKey))).body).items, []);
  const finish = fx.agentActivity.start({ tenantId: own.tenant.id, credentialId: own.key.id, credentialKind: "api_key", transport: "http" }); finish();
  const initial = await invoke(fx.router, request(path(fx, "agents"), own.apiKey));
  assert.equal(JSON.parse(initial.body).items[0].status, "recently_active");
  assert.doesNotMatch(initial.body, new RegExp(own.apiKey)); assert.doesNotMatch(initial.body, /key_hash/);
  fx.advance(60_000);
  const old = await invoke(fx.router, request(path(fx, "agents"), own.apiKey));
  assert.equal(JSON.parse(old.body).items[0].status, "inactive");
  const other = await invoke(fx.router, request(path(fx, "agents", 1), fx.credentials[1].apiKey));
  assert.deepEqual(JSON.parse(other.body).items, []);
  const replacement = await fx.userService.provisionApiKey({ tenant_id: own.tenant.id });
  await fx.userService.revokeApiKey(own.key.id);
  const revoked = await invoke(fx.router, request(path(fx, "agents"), replacement.apiKey));
  assert.equal(JSON.parse(revoked.body).items[0].status, "revoked");
});

test("real authenticated OpenAPI HTTP request is connected while pending and recent after completion", async (t) => {
  const fx = await fixture(); const own = fx.credentials[0];
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const pending = new Promise((resolve) => { release = resolve; });
  const openapi = createOpenapiRouter({ ...fx, projectRoot: process.cwd(), async getMemoryService() { entered(); await pending; return fx.memoryService; } });
  const server = http.createServer((req, res) => req.url.startsWith("/console/") ? fx.router(req, res) : openapi(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { release(); server.closeAllConnections(); server.close(); });
  const base = "http://127.0.0.1:" + server.address().port;
  const inflight = fetch(base + "/memories", { headers: { authorization: "Bearer " + own.apiKey } });
  await started;
  const snapshot = await fetch(base + path(fx, "agents"), { headers: { authorization: "Bearer " + own.apiKey } }).then((r) => r.json());
  assert.equal(snapshot.items[0].status, "connected"); assert.equal(snapshot.items[0].transport, "http");
  release(); assert.equal((await inflight).status, 200);
  assert.equal(fx.agentActivity.list(own.tenant.id).items[0].status, "recently_active");
});

test("fallback HTTP observes slow factory and releases aborted requests", async () => {
  const fx = await fixture(); const own = fx.credentials[0];
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const waiting = new Promise((resolve) => { release = resolve; });
  const handler = createApp({ ...fx, async getMemoryService() { entered(); await waiting; return fx.memoryService; } });
  const req = request("/memories", own.apiKey); const res = response(); const operation = handler(req, res);
  await started; assert.equal(fx.agentActivity.list(own.tenant.id).items[0].status, "connected");
  req.emit("aborted"); assert.equal(fx.agentActivity.list(own.tenant.id).items[0].status, "disconnected");
  release(); await operation; assert.equal(fx.agentActivity.list(own.tenant.id).items[0].status, "disconnected");
});

test("MCP authenticated transport observation is scoped and released on transport error", async () => {
  const fx = await fixture(); const own = fx.credentials[0];
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const waiting = new Promise((resolve) => { release = resolve; });
  const handler = createMcpRouter({ agentActivity: fx.agentActivity, publicUrl: "https://memory.example.test",
    oauthService: { async resolveAccessToken() { return { tenant_id: own.tenant.id, client_id: "verified-client", token_id: "token-id", scopes: ["memory:read"], resource: "https://memory.example.test/mcp" }; } },
    async getMemoryService() { entered(); await waiting; return fx.memoryService; },
    async serverFactory() { throw new Error("SECRET_TRANSPORT_DETAILS"); }
  });
  const req = request("/mcp", "alo_fixture", "POST"); const res = response(); const operation = handler(req, res);
  await started; const row = fx.agentActivity.list(own.tenant.id).items[0];
  assert.equal(row.status, "connected"); assert.equal(row.credential_id, "verified-client"); assert.equal(row.transport, "mcp");
  release(); await operation;
  assert.equal(fx.agentActivity.list(own.tenant.id).items[0].last_outcome, "failed");
  assert.doesNotMatch(res.body, /SECRET_TRANSPORT_DETAILS|alo_fixture/);
});
