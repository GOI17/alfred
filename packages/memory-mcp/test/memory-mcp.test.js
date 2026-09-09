import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { readMemoryMcpConfigFromEnv } from "../src/cli.js";
import { MEMORY_MCP_SERVER_OPTIONS, createZodSchemaAdapter, memoryToolNames, registerMemoryTools } from "../src/index.js";

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
    async captureMemory(input) {
      calls.push({ method: "captureMemory", input });
      return { status: "created", memory: { id: "mem_capture", ...input.candidate }, reason: "Durable source statement." };
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

test("registers exactly six tools", () => {
  const { server } = register();

  assert.deepEqual(
    server.tools.map((entry) => entry.name),
    ["memory_search", "memory_capture", "memory_create", "memory_update", "memory_delete", "memory_list"]
  );
  assert.deepEqual(memoryToolNames(), server.tools.map((entry) => entry.name));
});

test("zod schema adapter returns Standard Schema objects instead of raw shapes", () => {
  function schemaObject(shape) {
    return {
      kind: "object",
      shape,
      optional() { return { kind: "optional-object" }; },
      strict() {
        return this;
      },
      passthrough() {
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
        max() { return schema; },
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
        max() { return schema; },
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
    boolean() {
      return { kind: "boolean", optional: () => ({ kind: "optional-boolean" }) };
    },
    array(item) {
      return { kind: "array", item, max() { return this; }, optional: () => ({ kind: "optional-array", item }) };
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

test("publishes OpenAI security schemes, output schemas, and accurate safety annotations", () => {
  const { server } = register();
  const byName = Object.fromEntries(server.tools.map((entry) => [entry.name, entry.config]));

  for (const config of Object.values(byName)) {
    assert.ok(config.outputSchema);
    assert.deepEqual(config._meta.securitySchemes, config.securitySchemes);
    assert.equal(config.annotations.openWorldHint, false);
  }

  assert.deepEqual(byName.memory_search.securitySchemes, [{ type: "oauth2", scopes: ["memory:read"] }]);
  assert.equal(byName.memory_search.annotations.readOnlyHint, true);
  assert.equal(byName.memory_list.annotations.readOnlyHint, true);
  assert.equal(byName.memory_create.annotations.readOnlyHint, false);
  assert.equal(byName.memory_update.annotations.destructiveHint, false);
  assert.equal(byName.memory_delete.annotations.destructiveHint, true);
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

test("insufficient OAuth scope returns a safe MCP authentication challenge", async () => {
  const { server } = register({
    async createMemory() {
      const error = new Error("scope missing");
      error.name = "MemoryClientError";
      error.code = "insufficient_scope";
      error.status = 403;
      error.mcpChallenge = 'Bearer resource_metadata="https://memory.example.test/.well-known/oauth-protected-resource", error="insufficient_scope", error_description="Reconnect Alfred"';
      throw error;
    }
  });

  const result = await tool(server, "memory_create").handler({
    type: "fact",
    content: "Private",
    source: "test"
  });

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, "insufficient_scope");
  assert.equal(result.structuredContent.error.message, "Alfred needs an additional permission.");
  assert.equal(result._meta["mcp/www_authenticate"].length, 1);
  assert.equal(JSON.stringify(result).includes("scope missing"), false);
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


test("memory_capture carries grounded evidence, write scope and honest outcome metadata", async () => {
  const { server, memoryClient } = register();
  const capture = tool(server, "memory_capture");
  const input = { candidate: { content: "Prefiero respuestas breves", source: "user" }, context: { evidence: "Prefiero respuestas breves", origin: "user" } };
  const result = await capture.handler(input);
  assert.deepEqual(memoryClient.calls, [{ method: "captureMemory", input }]);
  assert.equal(result.structuredContent.status, "created");
  assert.deepEqual(capture.config.securitySchemes, [{ type: "oauth2", scopes: ["memory:write"] }]);
  assert.equal(capture.config.annotations.readOnlyHint, false);
  assert.match(capture.config.description, /without an explicit save request/);
});

test("memory_capture never represents a failed request as a saved memory", async () => {
  const { server } = register({ async captureMemory() { throw new Error("Private storage detail"); } });
  const result = await tool(server, "memory_capture").handler({ candidate: {}, context: {} });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.status, undefined);
  assert.ok(!JSON.stringify(result).includes("Private storage detail"));
});


test("MCP initialization instructions drive proactive capture and retain opt-out and honest results", () => {
  const instructions = MEMORY_MCP_SERVER_OPTIONS.instructions;
  assert.match(instructions, /proactively call memory_capture/);
  assert.match(instructions, /without waiting for an explicit request/);
  assert.match(instructions, /minimal exact source statement/);
  assert.match(instructions, /persistenceDisabled/);
  assert.match(instructions, /Only announce.*status is created/);
  assert.match(instructions, /Never retry a skipped capture through memory_create/);
});
