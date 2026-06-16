import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { readMemoryMcpConfigFromEnv } from "../src/cli.js";
import { createZodSchemaAdapter, memoryToolNames, registerMemoryTools } from "../src/index.js";

function createFakeServer() {
  return {
    tools: [],
    registerTool(name, config, handler) {
      this.tools.push({ name, config, handler });
      return { name };
    }
  };
}

function createFakeMemoryClient(overrides = {}) {
  const calls = [];
  const client = {
    calls,
    async searchMemories(input) {
      calls.push({ method: "searchMemories", input });
      return { items: [{ id: "mem_search", content: input.q }], pagination: { limit: 1, offset: 0, total: 1 } };
    },
    async createMemory(input) {
      calls.push({ method: "createMemory", input });
      return { id: "mem_create", ...input };
    },
    async updateMemory(id, patch) {
      calls.push({ method: "updateMemory", id, patch });
      return { id, ...patch };
    },
    async deleteMemory(id) {
      calls.push({ method: "deleteMemory", id });
      return { deleted: true };
    },
    async listMemories(input) {
      calls.push({ method: "listMemories", input });
      return { items: [], pagination: { limit: input.limit ?? 20, offset: input.offset ?? 0, total: 0 } };
    },
    ...overrides
  };
  return client;
}

function register(overrides = {}) {
  const server = createFakeServer();
  const memoryClient = createFakeMemoryClient(overrides);
  registerMemoryTools(server, { memoryClient });
  return { server, memoryClient };
}

function tool(server, name) {
  return server.tools.find((entry) => entry.name === name);
}

test("registers exactly five tools", () => {
  const { server } = register();

  assert.deepEqual(
    server.tools.map((entry) => entry.name),
    ["memory_search", "memory_create", "memory_update", "memory_delete", "memory_list"]
  );
  assert.deepEqual(memoryToolNames(), server.tools.map((entry) => entry.name));
});

test("zod schema adapter returns Standard Schema objects instead of raw shapes", () => {
  function schemaObject(shape) {
    return {
      kind: "object",
      shape,
      strict() {
        return this;
      }
    };
  }

  const fakeZod = {
    enum(values) {
      return { kind: "enum", values, optional: () => ({ kind: "optional-enum", values }) };
    },
    object(shape) {
      return schemaObject(shape);
    },
    string() {
      const schema = {
        kind: "string",
        min() {
          return schema;
        },
        optional() {
          return { kind: "optional-string" };
        },
        nullable() {
          return { kind: "nullable-string", optional: () => ({ kind: "optional-nullable-string" }) };
        }
      };
      return schema;
    },
    number() {
      const schema = {
        kind: "number",
        int() {
          return schema;
        },
        positive() {
          return schema;
        },
        min() {
          return schema;
        },
        optional() {
          return { kind: "optional-number" };
        },
        nullable() {
          return { kind: "nullable-number", optional: () => ({ kind: "optional-nullable-number" }) };
        }
      };
      return schema;
    },
    array(item) {
      return { kind: "array", item, optional: () => ({ kind: "optional-array", item }) };
    },
    record() {
      return { kind: "record", optional: () => ({ kind: "optional-record" }), nullable: () => ({ kind: "nullable-record", optional: () => ({ kind: "optional-nullable-record" }) }) };
    },
    unknown() {
      return { kind: "unknown" };
    }
  };

  const schemas = createZodSchemaAdapter(fakeZod);

  for (const [name, schema] of Object.entries(schemas)) {
    assert.equal(schema.kind, "object", `${name} must be wrapped with z.object(...)`);
  }
});

test("memory_search calls searchMemories and returns structuredContent", async () => {
  const { server, memoryClient } = register();

  const result = await tool(server, "memory_search").handler({ q: "hexagonal", limit: 1 });

  assert.deepEqual(memoryClient.calls, [{ method: "searchMemories", input: { q: "hexagonal", limit: 1 } }]);
  assert.equal(result.structuredContent.items[0].content, "hexagonal");
  assert.equal(JSON.parse(result.content[0].text).items[0].content, "hexagonal");
});

test("memory_create calls createMemory without MemoryPolicy", async () => {
  const { server, memoryClient } = register();

  const result = await tool(server, "memory_create").handler({
    type: "fact",
    content: "MCP adapter stays thin.",
    source: "test"
  });

  assert.deepEqual(memoryClient.calls, [
    {
      method: "createMemory",
      input: { type: "fact", content: "MCP adapter stays thin.", source: "test" }
    }
  ]);
  assert.equal("MemoryPolicy" in result.structuredContent, false);
  assert.equal("createMemoryPolicy" in result.structuredContent, false);
});

test("memory_update rejects namespace patch", async () => {
  const { server, memoryClient } = register();

  const result = await tool(server, "memory_update").handler({
    id: "mem_1",
    patch: { namespace: "other", content: "Updated" }
  });

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, "validation_error");
  assert.equal(memoryClient.calls.length, 0);
});

test("memory_update calls updateMemory", async () => {
  const { server, memoryClient } = register();

  const result = await tool(server, "memory_update").handler({
    id: "mem_1",
    patch: { content: "Updated" }
  });

  assert.deepEqual(memoryClient.calls, [{ method: "updateMemory", id: "mem_1", patch: { content: "Updated" } }]);
  assert.deepEqual(result.structuredContent, { id: "mem_1", content: "Updated" });
});

test("memory_delete calls deleteMemory", async () => {
  const { server, memoryClient } = register();

  const result = await tool(server, "memory_delete").handler({ id: "mem_1" });

  assert.deepEqual(memoryClient.calls, [{ method: "deleteMemory", id: "mem_1" }]);
  assert.deepEqual(result.structuredContent, { deleted: true });
});

test("memory_list calls listMemories", async () => {
  const { server, memoryClient } = register();

  const result = await tool(server, "memory_list").handler({ limit: 3, namespace: "project:alfred" });

  assert.deepEqual(memoryClient.calls, [
    { method: "listMemories", input: { limit: 3, namespace: "project:alfred" } }
  ]);
  assert.equal(result.structuredContent.pagination.limit, 3);
});

test("MemoryClientError maps to isError without secrets or stacks", async () => {
  const error = new Error("apiKey=test-api-key\n    at leakedStack");
  error.name = "MemoryClientError";
  error.code = "network_error";
  error.status = 503;
  error.details = [{ field: "apiKey", message: "test-api-key" }];
  const { server } = register({
    async searchMemories() {
      throw error;
    }
  });

  const result = await tool(server, "memory_search").handler({ q: "safe" });
  const serialized = JSON.stringify(result);

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, "network_error");
  assert.equal(result.structuredContent.error.status, 503);
  assert.equal(serialized.includes("test-api-key"), false);
  assert.equal(serialized.includes("leakedStack"), false);
  assert.equal(serialized.includes(" at "), false);
});

test("Unexpected error maps safely", async () => {
  const { server } = register({
    async listMemories() {
      throw new Error("database exploded with secret-token");
    }
  });

  const result = await tool(server, "memory_list").handler({});
  const serialized = JSON.stringify(result);

  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, {
    error: { code: "unexpected_error", message: "Unexpected error." }
  });
  assert.equal(serialized.includes("database exploded"), false);
  assert.equal(serialized.includes("secret-token"), false);
});

test("successful undefined payload still returns valid text content", async () => {
  const { server } = register({
    async deleteMemory() {
      return undefined;
    }
  });

  const result = await tool(server, "memory_delete").handler({ id: "mem_1" });

  assert.deepEqual(result.content, [{ type: "text", text: "null" }]);
  assert.equal(result.structuredContent, null);
});

test("CLI config helper fails if env vars are missing", () => {
  assert.throws(
    () => readMemoryMcpConfigFromEnv({ ALFRED_MEMORY_API_KEY: "key" }),
    /ALFRED_MEMORY_BASE_URL is required/
  );
  assert.throws(
    () => readMemoryMcpConfigFromEnv({ ALFRED_MEMORY_BASE_URL: "https://memory.example.test" }),
    /ALFRED_MEMORY_API_KEY is required/
  );
  assert.deepEqual(
    readMemoryMcpConfigFromEnv({
      ALFRED_MEMORY_BASE_URL: " https://memory.example.test/ ",
      ALFRED_MEMORY_API_KEY: " key "
    }),
    { baseUrl: "https://memory.example.test/", apiKey: "key" }
  );
});

test("does not import from packages/memory", async () => {
  const sources = await readSourceFiles();

  for (const [file, source] of sources) {
    assert.equal(source.includes("packages/memory"), false, file);
    assert.equal(source.includes("@alfred-labs/memory\""), false, file);
    assert.equal(source.includes("@alfred-labs/memory'"), false, file);
  }
});

test("does not reference memory policy symbols in src", async () => {
  const sources = await readSourceFiles();
  const forbidden = ["MemoryPolicy", "createMemoryPolicy", "shouldSearch", "shouldPersist"];

  for (const [file, source] of sources) {
    for (const symbol of forbidden) {
      assert.equal(source.includes(symbol), false, `${file} contains ${symbol}`);
    }
  }
});

test("repeated tool calls invoke memoryClient each time", async () => {
  const { server, memoryClient } = register();
  const search = tool(server, "memory_search");

  const first = await search.handler({ q: "one" });
  const second = await search.handler({ q: "two" });

  assert.equal(memoryClient.calls.length, 2);
  assert.deepEqual(memoryClient.calls.map((call) => call.input.q), ["one", "two"]);
  assert.notDeepEqual(first.structuredContent, second.structuredContent);
});

async function readSourceFiles() {
  const files = ["../src/errors.js", "../src/server.js", "../src/index.js", "../src/cli.js"];
  return Promise.all(
    files.map(async (file) => [file, await readFile(new URL(file, import.meta.url), "utf8")])
  );
}
