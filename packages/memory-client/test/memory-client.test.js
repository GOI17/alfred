import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { MemoryClientError, createMemoryClient } from "../src/index.js";

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json; charset=utf-8" }),
    async json() {
      return body;
    }
  };
}

function textResponse(body, { status = 500 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "text/plain" }),
    async text() {
      return body;
    }
  };
}

function fakeFetch(responseFactory) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return responseFactory(calls.length, url, init);
  };
  fetch.calls = calls;
  return fetch;
}

test("createMemory posts JSON with API key", async () => {
  const memory = { id: "mem_1", content: "Build stable clients." };
  const fetch = fakeFetch(() => jsonResponse(memory, { status: 201 }));
  const client = createMemoryClient({ baseUrl: "https://memory.example.test/", apiKey: "test-key", fetch });

  const result = await client.createMemory({ type: "fact", content: "Build stable clients." });

  assert.deepEqual(result, memory);
  assert.equal(fetch.calls[0].url, "https://memory.example.test/memories");
  assert.equal(fetch.calls[0].init.method, "POST");
  assert.equal(fetch.calls[0].init.headers["x-api-key"], "test-key");
  assert.equal(fetch.calls[0].init.headers["content-type"], "application/json");
  assert.equal(fetch.calls[0].init.body, JSON.stringify({ type: "fact", content: "Build stable clients." }));
});

test("getMemory fetches an encoded memory id", async () => {
  const fetch = fakeFetch(() => jsonResponse({ id: "memory id" }));
  const client = createMemoryClient({ baseUrl: "https://memory.example.test", apiKey: "test-key", fetch });

  await client.getMemory("memory id");

  assert.equal(fetch.calls[0].url, "https://memory.example.test/memories/memory%20id");
  assert.equal(fetch.calls[0].init.method, "GET");
});

test("listMemories serializes query params", async () => {
  const fetch = fakeFetch(() => jsonResponse({ items: [], total: 0, limit: 5, offset: 10 }));
  const client = createMemoryClient({ baseUrl: "https://memory.example.test", apiKey: "test-key", fetch });

  await client.listMemories({ limit: 5, offset: 10, type: "fact", namespace: "project:alfred", tag: "sdk" });

  const url = new URL(fetch.calls[0].url);
  assert.equal(url.pathname, "/memories");
  assert.equal(url.searchParams.get("limit"), "5");
  assert.equal(url.searchParams.get("offset"), "10");
  assert.equal(url.searchParams.get("type"), "fact");
  assert.equal(url.searchParams.get("namespace"), "project:alfred");
  assert.equal(url.searchParams.get("tag"), "sdk");
});

test("searchMemories requires q", async () => {
  const fetch = fakeFetch(() => jsonResponse({ items: [] }));
  const client = createMemoryClient({ baseUrl: "https://memory.example.test", apiKey: "test-key", fetch });

  assert.throws(
    () => client.searchMemories({ limit: 5 }),
    (error) => error instanceof MemoryClientError && error.code === "validation_error" && error.details[0].field === "q"
  );
  assert.equal(fetch.calls.length, 0);
});

test("searchMemories serializes q and query options", async () => {
  const fetch = fakeFetch(() => jsonResponse({ items: [], total: 0, q: "stable client" }));
  const client = createMemoryClient({ baseUrl: "https://memory.example.test", apiKey: "test-key", fetch });

  await client.searchMemories({ q: "stable client", limit: 3, namespace: "personal" });

  const url = new URL(fetch.calls[0].url);
  assert.equal(url.pathname, "/memories/search");
  assert.equal(url.searchParams.get("q"), "stable client");
  assert.equal(url.searchParams.get("limit"), "3");
  assert.equal(url.searchParams.get("namespace"), "personal");
});

test("updateMemory patches JSON by id", async () => {
  const fetch = fakeFetch(() => jsonResponse({ id: "mem_1", content: "Updated" }));
  const client = createMemoryClient({ baseUrl: "https://memory.example.test", apiKey: "test-key", fetch });

  await client.updateMemory("mem_1", { content: "Updated" });

  assert.equal(fetch.calls[0].url, "https://memory.example.test/memories/mem_1");
  assert.equal(fetch.calls[0].init.method, "PATCH");
  assert.equal(fetch.calls[0].init.headers["content-type"], "application/json");
  assert.equal(fetch.calls[0].init.body, JSON.stringify({ content: "Updated" }));
});

test("deleteMemory deletes by id", async () => {
  const fetch = fakeFetch(() => jsonResponse({ deleted: true }));
  const client = createMemoryClient({ baseUrl: "https://memory.example.test", apiKey: "test-key", fetch });

  const result = await client.deleteMemory("mem_1");

  assert.deepEqual(result, { deleted: true });
  assert.equal(fetch.calls[0].url, "https://memory.example.test/memories/mem_1");
  assert.equal(fetch.calls[0].init.method, "DELETE");
  assert.equal(fetch.calls[0].init.body, undefined);
});

test("JSON API errors preserve code, message, and details", async () => {
  const details = [{ field: "content", message: "content is required" }];
  const fetch = fakeFetch(() =>
    jsonResponse({ error: { code: "validation_error", message: "Invalid memory.", details } }, { status: 400 })
  );
  const client = createMemoryClient({ baseUrl: "https://memory.example.test", apiKey: "test-key", fetch });

  await assert.rejects(
    () => client.createMemory({ content: "" }),
    (error) => {
      assert(error instanceof MemoryClientError);
      assert.equal(error.code, "validation_error");
      assert.equal(error.message, "Invalid memory.");
      assert.equal(error.status, 400);
      assert.deepEqual(error.details, details);
      return true;
    }
  );
});

test("non-JSON non-2xx responses become http_error", async () => {
  const fetch = fakeFetch(() => textResponse("server exploded", { status: 502 }));
  const client = createMemoryClient({ baseUrl: "https://memory.example.test", apiKey: "test-key", fetch });

  await assert.rejects(
    () => client.getMemory("mem_1"),
    (error) => error instanceof MemoryClientError && error.code === "http_error" && error.status === 502
  );
});

test("fetch failures become network_error with cause", async () => {
  const cause = new Error("socket hang up");
  const fetch = async () => {
    throw cause;
  };
  const client = createMemoryClient({ baseUrl: "https://memory.example.test", apiKey: "test-key", fetch });

  await assert.rejects(
    () => client.getMemory("mem_1"),
    (error) => error instanceof MemoryClientError && error.code === "network_error" && error.cause === cause
  );
});

test("invalid configuration throws configuration_error", () => {
  assert.throws(
    () => createMemoryClient({ baseUrl: "not a url", apiKey: "test-key", fetch: async () => jsonResponse({}) }),
    (error) => error instanceof MemoryClientError && error.code === "configuration_error"
  );

  assert.throws(
    () => createMemoryClient({ baseUrl: "https://memory.example.test", apiKey: "", fetch: async () => jsonResponse({}) }),
    (error) => error instanceof MemoryClientError && error.code === "configuration_error"
  );
});

test("repeated calls do not cache responses", async () => {
  const fetch = fakeFetch((count) => jsonResponse({ id: `mem_${count}` }));
  const client = createMemoryClient({ baseUrl: "https://memory.example.test", apiKey: "test-key", fetch });

  const first = await client.getMemory("mem_1");
  const second = await client.getMemory("mem_1");

  assert.equal(fetch.calls.length, 2);
  assert.deepEqual(first, { id: "mem_1" });
  assert.deepEqual(second, { id: "mem_2" });
});

test("client does not import or expose MemoryPolicy", async () => {
  const client = createMemoryClient({
    baseUrl: "https://memory.example.test",
    apiKey: "test-key",
    fetch: async () => jsonResponse({})
  });

  assert.equal("MemoryPolicy" in client, false);
  assert.equal("createMemoryPolicy" in client, false);
  assert.equal(typeof client.shouldSearch, "undefined");
  assert.equal(typeof client.shouldPersist, "undefined");

  const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
  assert.equal(source.includes("MemoryPolicy"), false);
  assert.equal(source.includes("createMemoryPolicy"), false);
});
