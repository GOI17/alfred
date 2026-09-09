// Independent acceptance: real local transports and storage, no model/provider calls.
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createMemoryService, createInMemoryStore, createSqliteMemoryStore, createMemoryHttpHandler } from "../../memory/src/index.js";
import { createMemoryClient } from "../../memory-client/src/index.js";
import { createApp } from "../src/server.js";
import { createOpenapiRouter } from "../src/openapi-router.js";

const spanish = "Prefiero respuestas breves";
const english = "I prefer concise answers";
function capture(content = spanish, candidate = {}, context = {}) {
  return {
    candidate: { content, source: "user", ...candidate },
    context: { evidence: content, origin: "user", persistenceDisabled: false, ...context }
  };
}
const userService = {
  async resolveApiKey(key) {
    return { "alice-key": { tenant_id: "alice" }, "bob-key": { tenant_id: "bob" } }[key] ?? null;
  }
};
async function host(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}
async function fixture(t, { store = createInMemoryStore(), surface = "server" } = {}) {
  const traces = [];
  const service = createMemoryService({ store, trace: (event) => traces.push(event) });
  const getMemoryService = async () => service;
  const handler = surface === "domain"
    ? createMemoryHttpHandler({ service, apiKeys: { "alice-key": "alice", "bob-key": "bob" } })
    : surface === "action"
      ? createOpenapiRouter({ projectRoot: fileURLToPath(new URL("../../../", import.meta.url)), userService, getMemoryService, oauthService: {
        async resolveAccessToken(token) {
          if (token === "alo_read") return { tenant_id: "alice", scopes: ["memory:read"] };
          if (token === "alo_write") return { tenant_id: "alice", scopes: ["memory:read", "memory:write"] };
          return null;
        }
      } })
      : createApp({ userService, getMemoryService, config: { mode: "local", requireAuth: true } });
  const baseUrl = await host(t, handler);
  const alice = createMemoryClient({ baseUrl, apiKey: "alice-key" });
  const bob = createMemoryClient({ baseUrl, apiKey: "bob-key" });
  async function wire(input, credential = "alice-key") {
    const res = await fetch(`${baseUrl}/memories/capture`, {
      method: "POST", headers: { "content-type": "application/json", ...(credential ? { authorization: `Bearer ${credential}` } : {}) },
      body: JSON.stringify(input)
    });
    return { status: res.status, body: await res.json() };
  }
  return { service, store, traces, baseUrl, alice, bob, wire };
}

for (const surface of ["domain", "server", "action"]) {
  test(`proactive acceptance: ${surface} HTTP captures unrequested ES/EN preferences and retrieves actual records`, async (t) => {
    const f = await fixture(t, { surface });
    for (const content of [spanish, english]) {
      const result = await f.alice.captureMemory(capture(content, { projectId: "alfred", tags: ["communication"] }));
      assert.equal(result.status, "created");
      assert.ok(result.memory.id);
      assert.equal(result.memory.namespace, "project:alfred");
      assert.equal(result.memory.source, "user");
      assert.equal(result.memory.type, "preference");
      const retrieved = await f.alice.getMemory(result.memory.id);
      assert.equal(retrieved.content, content);
      assert.equal(retrieved.userId, "alice");
      assert.equal(JSON.stringify(retrieved).includes('"evidence"'), false, "raw source context is not persisted");
    }
    assert.equal((await f.alice.listMemories({ namespace: "project:alfred" })).pagination.total, 2);
    assert.equal((await f.bob.listMemories({ namespace: "project:alfred" })).pagination.total, 0);
  });
}

test("proactive acceptance: source exclusions, uncertainty, sensitive and temporary candidates never write", async (t) => {
  const f = await fixture(t);
  const denied = [
    capture(spanish, {}, { persistenceDisabled: true }),
    capture(spanish, {}, { evidence: "Prefiero respuestas breves; no guardes esto" }),
    capture(english, {}, { evidence: "I prefer concise answers; do not remember this" }),
    capture(spanish, {}, { evidence: "No quiero que guardes esto. Prefiero respuestas breves" }),
    capture(spanish, {}, { evidence: "No lo recuerdes. Prefiero respuestas breves" }),
    capture("I prefer tabs", {}, { evidence: "Please do not persist this. I prefer tabs" }),
    capture("The project token is ghp_abcdefghijklmnopqrstuvwxyz1234567890", { type: "project" }),
    capture("INFO service started successfully", { type: "fact" }),
    capture("Maybe I prefer concise answers", { type: "preference" }),
    capture("Quizás prefiero respuestas breves", { type: "preference" }),
    capture("Do I prefer concise answers?", { type: "preference" }),
    capture("¿Prefiero respuestas breves?", { type: "preference" }),
    capture("For this task I prefer concise answers", { type: "preference" }),
    capture("Solo por hoy prefiero respuestas breves", { type: "preference" }),
    capture("My password is dummy-secret-for-test", { type: "fact" }),
    capture("Mi contraseña es prueba-no-real", { type: "fact" }),
    capture("My credit card number is 4111 1111 1111 1111", { type: "fact" }),
    capture("Mi diagnóstico médico es diabetes", { type: "fact" }),
    capture(spanish, {}, { evidence: "Mi contraseña es prueba-no-real. Prefiero respuestas breves" }),
    capture("The current process PID is 4212", { type: "project" }),
    capture("Internal chain of thought: I prefer concise answers", { type: "preference" }),
    capture(spanish, {}, { evidence: "I prefer detailed explanations" }),
    capture("okay", { type: "preference", tags: ["preference"] }, { evidence: english })
  ];
  const failures = [];
  for (const input of denied) {
    const result = await f.alice.captureMemory(input);
    if (result.status !== "skipped") failures.push({ input, result: result.status });
    else assert.deepEqual(Object.keys(result).sort(), ["reason", "status"]);
  }
  assert.deepEqual(failures, [], "all unsafe/uncertain candidates must skip");
  assert.equal((await f.alice.listMemories({})).pagination.total, 0);
  const serialized = JSON.stringify(f.traces);
  for (const raw of [spanish, english, "dummy-secret-for-test", "prueba-no-real", "4111 1111", "diabetes"]) {
    assert.equal(serialized.includes(raw), false, "trace excludes rejected content and context");
  }
  assert.ok(f.traces.length > 0, "capture emits auditable outcomes");
  for (const event of f.traces) {
    assert.equal(event.event, "memory.capture");
    assert.equal(event.payload.provider_calls, 0);
    assert.equal(event.payload.outcome, "skipped");
  }
});

test("proactive acceptance: malformed context and empty candidates fail without writes or raw validation leaks", async (t) => {
  const f = await fixture(t);
  const valid = capture();
  const invalid = [
    capture(spanish, { metadata: { credentials: "password=dummy-secret-for-test" } }),
    { candidate: valid.candidate },
    { candidate: valid.candidate, context: {} },
    { candidate: valid.candidate, context: { evidence: "", origin: "user", persistenceDisabled: false } },
    { candidate: valid.candidate, context: { evidence: spanish, origin: "user", persistenceDisabled: "false" } },
    capture("", { type: "preference" }, { evidence: spanish }),
    capture("   ", { type: "preference" }, { evidence: english })
  ];
  for (const input of invalid) {
    const result = await f.wire(input);
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, "validation_error");
    assert.equal(JSON.stringify(result.body).includes(spanish), false);
  }
  assert.equal((await f.alice.listMemories({})).pagination.total, 0);
});

test("proactive acceptance: repeated completed capture deduplicates beyond one page within tenant and namespace", async (t) => {
  const f = await fixture(t);
  const initial = await f.alice.captureMemory(capture(english));
  for (let index = 0; index < 120; index++) {
    await f.alice.createMemory({ content: `Fixture record ${index}`, source: "test", type: "fact" });
  }
  const duplicate = await f.alice.captureMemory(capture("I prefer   concise answers"));
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.memory.id, initial.memory.id);
  assert.equal((await f.alice.listMemories({})).pagination.total, 121);
  const namespace = await f.alice.captureMemory(capture(english, { namespace: "work" }));
  const tenant = await f.bob.captureMemory(capture(english));
  assert.equal(namespace.status, "created");
  assert.equal(tenant.status, "created");
  assert.notEqual(namespace.memory.id, initial.memory.id);
  assert.notEqual(tenant.memory.id, initial.memory.id);
  await assert.rejects(f.bob.getMemory(initial.memory.id), (error) => error.code === "not_found");
});

test("proactive acceptance: authenticated capture ignores or rejects request tenant spoofing and requires write scope", async (t) => {
  const f = await fixture(t, { surface: "action" });
  assert.equal((await f.wire(capture(), null)).status, 401);
  assert.equal((await f.wire(capture(), "alo_read")).status, 403);
  const forged = capture(english, { userId: "bob", tenant_id: "bob" }, { tenant_id: "bob" });
  const result = await f.wire({ ...forged, tenant_id: "bob" }, "alo_write");
  assert.ok([200, 400].includes(result.status));
  if (result.status === 200) {
    assert.equal(result.body.status, "created");
    assert.equal(result.body.memory.userId, "alice");
  }
  assert.equal((await f.bob.listMemories({})).pagination.total, 0);
});

test("proactive acceptance: persistence failure and transport failure cannot report a saved memory", async (t) => {
  const baseStore = createInMemoryStore();
  const f = await fixture(t, { store: { ...baseStore, async create() { throw new Error("storage secret=dummy-secret-for-test"); } } });
  const result = await f.wire(capture());
  assert.equal(result.status, 500);
  assert.notEqual(result.body.status, "created");
  assert.equal(JSON.stringify(result.body).includes("dummy-secret-for-test"), false);
  assert.equal(JSON.stringify(f.traces).includes("dummy-secret-for-test"), false);
  assert.equal((await f.alice.listMemories({})).pagination.total, 0);
  const disconnected = createMemoryClient({ baseUrl: f.baseUrl, apiKey: "alice-key", fetch: async () => { throw new Error("connection failed"); } });
  await assert.rejects(disconnected.captureMemory(capture()), (error) => error.code === "network_error");
});

test("proactive acceptance: ordinary explicit create/read/update/delete remains available", async (t) => {
  const f = await fixture(t);
  const created = await f.alice.createMemory({ content: "Explicitly selected note", type: "fact", source: "user" });
  assert.equal((await f.alice.getMemory(created.id)).content, "Explicitly selected note");
  const updated = await f.alice.updateMemory(created.id, { content: "Revised explicit note" });
  assert.equal(updated.content, "Revised explicit note");
  assert.equal((await f.alice.deleteMemory(created.id)).deleted, true);
  assert.equal((await f.alice.listMemories({})).pagination.total, 0);
});

test("proactive acceptance: real stdio MCP to HTTP to SQLite captures ordinary utterance and survives reopen", async (t) => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const directory = await mkdtemp(join(tmpdir(), "alfred-proactive-acceptance-"));
  const dbPath = join(directory, "memory.sqlite");
  let db = new DatabaseSync(dbPath);
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  db.exec(await readFile(new URL("../../memory/migrations/sqlite/001_memory.sqlite.sql", import.meta.url), "utf8"));
  const f = await fixture(t, { store: createSqliteMemoryStore(db) });
  const client = new Client({ name: "proactive-capture-acceptance", version: "1.0.0" });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../../memory-mcp/src/cli.js", import.meta.url))],
    env: { ALFRED_MEMORY_BASE_URL: f.baseUrl, ALFRED_MEMORY_API_KEY: "alice-key" },
    stderr: "pipe"
  }));
  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === "memory_capture"));
  const created = await client.callTool({ name: "memory_capture", arguments: capture(spanish) });
  assert.equal(created.isError, undefined);
  assert.equal(created.structuredContent.status, "created");
  const id = created.structuredContent.memory.id;
  const listed = await client.callTool({ name: "memory_list", arguments: {} });
  assert.equal(listed.structuredContent.items[0].id, id);
  const duplicate = await client.callTool({ name: "memory_capture", arguments: capture(spanish) });
  assert.equal(duplicate.structuredContent.status, "duplicate");
  const denied = await client.callTool({ name: "memory_capture", arguments: capture(english, {}, { persistenceDisabled: true }) });
  assert.equal(denied.structuredContent.status, "skipped");
  await client.close();
  db.close();
  db = new DatabaseSync(dbPath);
  const persisted = await createMemoryService({ store: createSqliteMemoryStore(db) }).getMemory("alice", id);
  assert.equal(persisted.content, spanish);
  assert.deepEqual(persisted.metadata, {});
  for (const key of ["context", "evidence", "origin", "persistenceDisabled"]) assert.equal(Object.hasOwn(persisted, key), false);
  assert.equal(db.prepare("SELECT count(*) AS count FROM alfred_memories").get().count, 1);
});


test("proactive acceptance: remote MCP OAuth captures to shared store and read-only authorization cannot write", async (t) => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const { createMcpRouter } = await import("../src/mcp-router.js");
  const store = createInMemoryStore();
  const service = createMemoryService({ store });
  let handler;
  const baseUrl = await host(t, (req, res) => handler(req, res));
  handler = createMcpRouter({
    publicUrl: baseUrl, getMemoryService: async () => service,
    oauthService: { async resolveAccessToken(token) {
      if (!["alo_write", "alo_read", "alo_bob"].includes(token)) return null;
      return { tenant_id: token === "alo_bob" ? "bob" : "alice", resource: `${baseUrl}/mcp`,
        scopes: token === "alo_read" ? ["memory:read"] : ["memory:read", "memory:write"] };
    } }
  });
  const clients = {};
  for (const token of ["alo_write", "alo_read", "alo_bob"]) {
    const client = new Client({ name: "proactive-remote-acceptance", version: "1.0.0" });
    t.after(() => client.close());
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } }
    }));
    clients[token] = client;
  }
  const readonly = await clients.alo_read.callTool({ name: "memory_capture", arguments: capture(spanish) });
  assert.equal(readonly.isError, true);
  assert.equal((await service.listMemories("alice", {})).pagination.total, 0);
  const created = await clients.alo_write.callTool({ name: "memory_capture", arguments: capture(spanish) });
  assert.equal(created.structuredContent.status, "created");
  const found = await clients.alo_read.callTool({ name: "memory_search", arguments: { q: "respuestas breves" } });
  assert.equal(found.structuredContent.items[0].id, created.structuredContent.memory.id);
  const independent = await clients.alo_bob.callTool({ name: "memory_capture", arguments: capture(spanish) });
  assert.equal(independent.structuredContent.status, "created");
  assert.notEqual(independent.structuredContent.memory.id, created.structuredContent.memory.id);
  const forged = await clients.alo_write.callTool({ name: "memory_capture", arguments: capture(english, { userId: "bob" }) });
  assert.equal(forged.isError, true);
  assert.equal((await service.listMemories("bob", {})).pagination.total, 1);
  const missing = await fetch(`${baseUrl}/mcp`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "memory_capture", arguments: capture() } }) });
  assert.equal(missing.status, 401);
});


test("proactive acceptance: unconfirmed store writes and duplicate lookup failures produce failed redacted traces", async (t) => {
  for (const failure of ["unconfirmed_write", "lookup_failure"]) {
    await t.test(failure, async (t) => {
      const base = createInMemoryStore();
      const store = failure === "unconfirmed_write"
        ? { ...base, async create() { return undefined; } }
        : { ...base, async list() { throw new Error("untrusted-context-marker"); } };
      const f = await fixture(t, { store });
      const result = await f.wire(capture());
      assert.equal(result.status, 500);
      assert.equal(Object.hasOwn(result.body, "memory"), false);
      assert.equal(f.traces.at(-1).payload.outcome, "failed");
      assert.ok(f.traces.every((event) => event.payload.outcome !== "created" && event.payload.provider_calls === 0));
      assert.equal(JSON.stringify(f.traces).includes("untrusted-context-marker"), false);
      assert.equal((await base.list("alice", { limit: 20, offset: 0 })).pagination.total, 0);
    });
  }
});
