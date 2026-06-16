import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  createMemoryClient,
  createMemoryHttpServer,
  createMemoryService,
  createInMemoryStore,
  createPostgresMemoryStore
} from "../src/index.js";

let server;
let baseUrl;

async function startTestServer() {
  const store = createInMemoryStore();
  const service = createMemoryService({ store });
  server = createMemoryHttpServer({
    service,
    apiKeys: {
      "alice-key": "alice",
      "bob-key": "bob"
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer() {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
}

beforeEach(startTestServer);
afterEach(stopTestServer);

describe("Alfred Memory HTTP API and SDK", () => {
  test("creates, reads, lists, searches, updates, and deletes memories for an authenticated user", async () => {
    const client = createMemoryClient({ baseUrl, apiKey: "alice-key" });

    const created = await client.createMemory({
      type: "preference",
      content: "Alice prefers deterministic local tools before provider calls.",
      tags: ["local-first", "policy"],
      source: "codex",
      metadata: { project: "alfred" },
      confidence: 0.92
    });

    assert.equal(created.userId, "alice");
    assert.equal(created.type, "preference");
    assert.equal(created.projectId, undefined);
    assert.ok(created.id);
    assert.ok(created.createdAt);
    assert.ok(created.updatedAt);

    const fetched = await client.getMemory(created.id);
    assert.equal(fetched.id, created.id);
    assert.equal(fetched.content, created.content);

    const listed = await client.listMemories({ limit: 10 });
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0].id, created.id);
    assert.equal(listed.pagination.limit, 10);

    const searchResult = await client.searchMemories({ q: "deterministic provider" });
    assert.deepEqual(
      searchResult.items.map((memory) => memory.id),
      [created.id]
    );

    const updated = await client.updateMemory(created.id, {
      content: "Alice prefers deterministic local computation before provider calls.",
      tags: ["local-first", "updated"],
      userId: "bob",
      confidence: 1
    });
    assert.equal(updated.content, "Alice prefers deterministic local computation before provider calls.");
    assert.equal(updated.userId, "alice");
    assert.deepEqual(updated.tags, ["local-first", "updated"]);
    assert.equal(updated.confidence, 1);

    const deleteResult = await client.deleteMemory(created.id);
    assert.deepEqual(deleteResult, { deleted: true });

    await assert.rejects(() => client.getMemory(created.id), {
      name: "MemoryApiError",
      status: 404,
      code: "not_found"
    });
  });

  test("rejects missing, invalid, and malformed authenticated requests with predictable JSON errors", async () => {
    const missingAuth = await fetch(`${baseUrl}/memories`);
    assert.equal(missingAuth.status, 401);
    assert.deepEqual(await missingAuth.json(), {
      error: {
        code: "unauthorized",
        message: "A valid API key is required."
      }
    });

    const invalidAuth = await fetch(`${baseUrl}/memories`, {
      headers: { "x-api-key": "nope" }
    });
    assert.equal(invalidAuth.status, 401);
    assert.equal((await invalidAuth.json()).error.code, "unauthorized");

    const client = createMemoryClient({ baseUrl, apiKey: "alice-key" });
    await assert.rejects(
      () =>
        client.createMemory({
          type: "unknown",
          content: "Invalid type should fail.",
          tags: [],
          source: "test"
        }),
      {
        name: "MemoryApiError",
        status: 400,
        code: "validation_error"
      }
    );

    const malformedJson = await fetch(`${baseUrl}/memories`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "alice-key"
      },
      body: '{"type":'
    });
    assert.equal(malformedJson.status, 400);
    assert.deepEqual(await malformedJson.json(), {
      error: {
        code: "validation_error",
        message: "Request body must be valid JSON.",
        details: [{ field: "body", message: "Request body must be valid JSON." }]
      }
    });

    const invalidPagination = await fetch(`${baseUrl}/memories?limit=10abc&offset=1.5`, {
      headers: { "x-api-key": "alice-key" }
    });
    assert.equal(invalidPagination.status, 400);
    const invalidPaginationBody = await invalidPagination.json();
    assert.equal(invalidPaginationBody.error.code, "validation_error");
    assert.deepEqual(
      invalidPaginationBody.error.details.map((detail) => detail.field),
      ["limit", "offset"]
    );

    const malformedMemoryId = await fetch(`${baseUrl}/memories/%E0%A4%A`, {
      headers: { "x-api-key": "alice-key" }
    });
    assert.equal(malformedMemoryId.status, 400);
    const malformedMemoryIdBody = await malformedMemoryId.json();
    assert.equal(malformedMemoryIdBody.error.code, "validation_error");
    assert.notEqual(malformedMemoryIdBody.error.code, "internal_error");
  });

  test("isolates tenants so one API key cannot read, search, update, or delete another user's memories", async () => {
    const alice = createMemoryClient({ baseUrl, apiKey: "alice-key" });
    const bob = createMemoryClient({ baseUrl, apiKey: "bob-key" });

    const aliceMemory = await alice.createMemory({
      type: "decision",
      content: "Alice decided to keep packages/core harness agnostic.",
      tags: ["architecture"],
      source: "test"
    });

    const bobMemory = await bob.createMemory({
      type: "fact",
      content: "Bob owns a different memory tenant.",
      tags: ["tenant"],
      source: "test"
    });

    const bobList = await bob.listMemories();
    assert.deepEqual(
      bobList.items.map((memory) => memory.id),
      [bobMemory.id]
    );

    const bobSearch = await bob.searchMemories({ q: "harness agnostic" });
    assert.equal(bobSearch.items.length, 0);

    await assert.rejects(() => bob.getMemory(aliceMemory.id), {
      name: "MemoryApiError",
      status: 404,
      code: "not_found"
    });

    await assert.rejects(() => bob.updateMemory(aliceMemory.id, { content: "stolen" }), {
      name: "MemoryApiError",
      status: 404,
      code: "not_found"
    });

    await assert.rejects(() => bob.deleteMemory(aliceMemory.id), {
      name: "MemoryApiError",
      status: 404,
      code: "not_found"
    });

    assert.equal((await alice.getMemory(aliceMemory.id)).id, aliceMemory.id);
  });
});


describe("In-memory store adapter", () => {
  test("preserves ownership and immutable fields when direct callers patch them", async () => {
    const store = createInMemoryStore();
    await store.create({
      id: "memory-1",
      userId: "alice",
      type: "fact",
      content: "Direct store callers cannot change ownership.",
      tags: ["tenant"],
      source: "test",
      metadata: {},
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z"
    });

    const updated = await store.update("alice", "memory-1", {
      id: "memory-2",
      userId: "bob",
      createdAt: "2026-06-16T00:00:00.000Z",
      content: "Only editable fields should change.",
      updatedAt: "2026-06-15T00:01:00.000Z"
    });

    assert.equal(updated.id, "memory-1");
    assert.equal(updated.userId, "alice");
    assert.equal(updated.createdAt, "2026-06-15T00:00:00.000Z");
    assert.equal(updated.content, "Only editable fields should change.");
    assert.equal((await store.get("alice", "memory-1")).userId, "alice");
    assert.equal(await store.get("bob", "memory-1"), undefined);
  });
});


describe("PostgreSQL store adapter", () => {
  test("uses a pg-style client and scopes all operations by userId", async () => {
    const calls = [];
    const row = {
      id: "memory-1",
      user_id: "alice",
      project_id: null,
      type: "fact",
      content: "Postgres adapters use pg-style clients.",
      tags: ["postgres"],
      source: "test",
      metadata: {},
      confidence: null,
      expires_at: null,
      created_at: "2026-06-15T00:00:00.000Z",
      updated_at: "2026-06-15T00:00:00.000Z",
      total_count: "1"
    };
    const client = {
      async query(text, values) {
        calls.push({ text, values });
        if (text.startsWith("DELETE")) return { rows: [], rowCount: 1 };
        return { rows: [row], rowCount: 1 };
      }
    };
    const store = createPostgresMemoryStore(client);

    await store.create({
      id: "memory-1",
      userId: "alice",
      type: "fact",
      content: "Postgres adapters use pg-style clients.",
      tags: ["postgres"],
      source: "test",
      metadata: {},
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z"
    });
    await store.list("alice", { limit: 10, offset: 0 });
    await store.search("alice", { q: "postgres", limit: 10, offset: 0 });
    await store.get("alice", "memory-1");
    await store.update("alice", "memory-1", { content: "Updated", updatedAt: "2026-06-15T00:01:00.000Z" });
    assert.equal(await store.delete("alice", "memory-1"), true);

    assert.equal(calls.length, 6);
    assert.ok(calls.slice(1).every((call) => call.text.includes("user_id")));
    assert.ok(calls.slice(1).every((call) => call.values.includes("alice")));
    assert.ok(calls[2].text.includes("ILIKE"));
    assert.ok(calls[2].text.includes("plainto_tsquery"));
  });

  test("reports total count when list and search offsets are beyond the returned page", async () => {
    const calls = [];
    const client = {
      async query(text, values) {
        calls.push({ text, values });
        if (text.includes("COUNT(*) AS total_count")) return { rows: [{ total_count: "2" }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }
    };
    const store = createPostgresMemoryStore(client);

    const listed = await store.list("alice", { limit: 10, offset: 100 });
    assert.deepEqual(listed.items, []);
    assert.deepEqual(listed.pagination, { limit: 10, offset: 100, total: 2 });

    const searched = await store.search("alice", { q: "postgres", limit: 10, offset: 100 });
    assert.deepEqual(searched.items, []);
    assert.deepEqual(searched.pagination, { limit: 10, offset: 100, total: 2 });

    assert.equal(calls.length, 4);
    assert.ok(calls[1].text.includes("COUNT(*) AS total_count"));
    assert.ok(calls[3].text.includes("COUNT(*) AS total_count"));
    assert.ok(calls.every((call) => call.values.includes("alice")));
  });
});
