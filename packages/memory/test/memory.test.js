import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  createMemoryClient,
  createMemoryHttpHandler,
  createMemoryService,
  createInMemoryStore,
  createPostgresMemoryStore
} from "../src/index.js";

let baseUrl;
let originalFetch;

function lowerCaseHeaders(headers = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) normalized[key.toLowerCase()] = value;
  return normalized;
}

function fakeReq({ method = "GET", url = "/", headers = {}, body = undefined } = {}) {
  return {
    method,
    url,
    headers: lowerCaseHeaders(headers),
    [Symbol.asyncIterator]() {
      const chunks = body === undefined ? [] : [Buffer.from(String(body))];
      let index = 0;
      return {
        next() {
          if (index < chunks.length) return Promise.resolve({ value: chunks[index++], done: false });
          return Promise.resolve({ value: undefined, done: true });
        }
      };
    }
  };
}

async function invoke(handler, req) {
  const res = {
    statusCode: 200,
    headers: {},
    chunks: [],
    writeHead(status, headers) {
      this.statusCode = status;
      for (const [key, value] of Object.entries(headers ?? {})) this.headers[key.toLowerCase()] = value;
    },
    end(chunk) {
      if (chunk !== undefined) this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
  };
  await handler(req, res);
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: Buffer.concat(res.chunks)
  };
}

function createHandlerFetch(handler) {
  return async function handlerFetch(input, init = {}) {
    const url = new URL(String(input));
    const req = fakeReq({
      method: init.method ?? "GET",
      url: `${url.pathname}${url.search}`,
      headers: init.headers ?? {},
      body: init.body
    });
    const res = await invoke(handler, req);
    return new Response(res.body, {
      status: res.statusCode,
      headers: res.headers
    });
  };
}

async function startTestServer() {
  const store = createInMemoryStore();
  const service = createMemoryService({ store });
  const handler = createMemoryHttpHandler({
    service,
    apiKeys: {
      "alice-key": "alice",
      "bob-key": "bob"
    }
  });
  originalFetch = globalThis.fetch;
  globalThis.fetch = createHandlerFetch(handler);
  baseUrl = "http://memory.test";
}

async function stopTestServer() {
  globalThis.fetch = originalFetch;
  originalFetch = undefined;
}

beforeEach(startTestServer);
afterEach(stopTestServer);

describe("Alfred Memory HTTP API and SDK", () => {
  test("partitions list and search by namespace while direct id access stays user-scoped", async () => {
    const client = createMemoryClient({ baseUrl, apiKey: "alice-key" });

    const personal = await client.createMemory({
      type: "preference",
      content: "Alice keeps personal memory separate from work memory.",
      tags: ["namespace"],
      source: "test"
    });
    const work = await client.createMemory({
      namespace: "work",
      type: "preference",
      content: "Alice keeps work memory separate from personal memory.",
      tags: ["namespace"],
      source: "test"
    });

    assert.equal(personal.namespace, "personal");
    assert.equal(work.namespace, "work");

    const workList = await client.listMemories({ namespace: "work" });
    assert.deepEqual(
      workList.items.map((memory) => memory.id),
      [work.id]
    );

    const workSearch = await client.searchMemories({ namespace: "work", q: "separate memory" });
    assert.deepEqual(
      workSearch.items.map((memory) => memory.id),
      [work.id]
    );

    assert.equal((await client.getMemory(personal.id)).namespace, "personal");
    assert.equal((await client.getMemory(work.id)).namespace, "work");
  });

  test("derives namespace from projectId unless namespace is provided explicitly", async () => {
    const client = createMemoryClient({ baseUrl, apiKey: "alice-key" });

    const projectMemory = await client.createMemory({
      projectId: "alfred",
      type: "decision",
      content: "Project fallback derives a namespace.",
      tags: ["namespace"],
      source: "test"
    });
    const teamMemory = await client.createMemory({
      namespace: "team:platform",
      projectId: "alfred",
      type: "decision",
      content: "Explicit namespace wins over project metadata.",
      tags: ["namespace"],
      source: "test"
    });

    assert.equal(projectMemory.namespace, "project:alfred");
    assert.equal(projectMemory.projectId, "alfred");
    assert.equal(teamMemory.namespace, "team:platform");
    assert.equal(teamMemory.projectId, "alfred");

    const projectList = await client.listMemories({ namespace: "project:alfred" });
    assert.deepEqual(
      projectList.items.map((memory) => memory.id),
      [projectMemory.id]
    );
  });

  test("rejects unsafe namespaces and prevents namespace changes through PATCH", async () => {
    const client = createMemoryClient({ baseUrl, apiKey: "alice-key" });
    const maxLengthNamespace = "a".repeat(120);
    const memory = await client.createMemory({
      namespace: "custom:name_1",
      type: "fact",
      content: "Custom safe namespaces may use lowercase letters, numbers, dash, underscore, and colon.",
      tags: ["namespace"],
      source: "test"
    });

    assert.equal(memory.namespace, "custom:name_1");

    const maxLengthMemory = await client.createMemory({
      namespace: maxLengthNamespace,
      type: "fact",
      content: "Safe namespaces may use the full maximum length.",
      tags: ["namespace"],
      source: "test"
    });
    assert.equal(maxLengthMemory.namespace, maxLengthNamespace);

    for (const namespace of ["", "Work", "bad space", "project:", "team:", "bad/value", "a".repeat(121)]) {
      await assert.rejects(
        () =>
          client.createMemory({
            namespace,
            type: "fact",
            content: "Unsafe namespace should fail.",
            tags: ["namespace"],
            source: "test"
          }),
        {
          name: "MemoryApiError",
          status: 400,
          code: "validation_error"
        }
      );
    }

    await assert.rejects(() => client.listMemories({ namespace: "Work" }), {
      name: "MemoryApiError",
      status: 400,
      code: "validation_error"
    });

    await assert.rejects(() => client.searchMemories({ namespace: "bad space", q: "namespace" }), {
      name: "MemoryApiError",
      status: 400,
      code: "validation_error"
    });

    await assert.rejects(() => client.updateMemory(memory.id, { namespace: "work" }), {
      name: "MemoryApiError",
      status: 400,
      code: "validation_error"
    });

    const updated = await client.updateMemory(memory.id, { projectId: "alfred" });
    assert.equal(updated.namespace, "custom:name_1");
    assert.equal(updated.projectId, "alfred");
  });

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
    assert.equal(created.namespace, "personal");
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
      namespace: "work",
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
      namespace: "work",
      type: "fact",
      content: "Postgres adapters use pg-style clients.",
      tags: ["postgres"],
      source: "test",
      metadata: {},
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z"
    });
    await store.list("alice", { namespace: "work", limit: 10, offset: 0 });
    await store.search("alice", { namespace: "work", q: "postgres", limit: 10, offset: 0 });
    await store.get("alice", "memory-1");
    await store.update("alice", "memory-1", { content: "Updated", updatedAt: "2026-06-15T00:01:00.000Z" });
    assert.equal(await store.delete("alice", "memory-1"), true);

    assert.equal(calls.length, 6);
    assert.ok(calls[0].text.includes("namespace"));
    assert.ok(calls[0].values.includes("work"));
    assert.ok(calls.slice(1).every((call) => call.text.includes("user_id")));
    assert.ok(calls.slice(1).every((call) => call.values.includes("alice")));
    assert.ok(calls[1].text.includes("namespace"));
    assert.ok(calls[1].values.includes("work"));
    assert.ok(calls[2].text.includes("namespace"));
    assert.ok(calls[2].values.includes("work"));
    assert.ok(calls[2].text.includes("ILIKE"));
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
