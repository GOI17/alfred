import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { createMcpServer, makeStdioRunner } = await import("../src/server.mjs");

function freshDir() {
  return mkdtempSync(join(tmpdir(), "alfred-mcp-"));
}
function mkdirSync2(dir) {
  mkdirSync(join(dir, ".alfred"), { recursive: true });
}

function writeConfig(dir, { apiKey = "alk_test", baseUrl = "http://localhost:3000" } = {}) {
  mkdirSync2(dir);
  writeFileSync(join(dir, ".alfred", "config.json"), JSON.stringify({
    registry: "/tmp/x.sqlite",
    tenant: { id: "usr_t_test", kind: "coding_agent_only", storage_backend: "sqlite" },
    api_key: apiKey
  }));
}

test("createMcpServer rejects missing config", () => {
  const dir = freshDir();
  try {
    assert.throws(
      () => createMcpServer({ cwd: dir }),
      /No Alfred config/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createMcpServer accepts a workspace config", () => {
  const dir = freshDir();
  try {
    writeConfig(dir);
    const server = createMcpServer({ cwd: dir });
    assert.ok(server);
    const tools = server.listTools();
    assert.equal(tools.length, 5);
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("alfred_list_memories"));
    assert.ok(names.includes("alfred_search_memories"));
    assert.ok(names.includes("alfred_create_memory"));
    assert.ok(names.includes("alfred_get_memory"));
    assert.ok(names.includes("alfred_delete_memory"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("handleJsonRpc: initialize returns protocol info", async () => {
  const dir = freshDir();
  try {
    writeConfig(dir);
    const server = createMcpServer({ cwd: dir });
    const resp = await server.handleJsonRpc({
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {} }
    });
    assert.equal(resp.jsonrpc, "2.0");
    assert.equal(resp.id, 1);
    assert.equal(resp.result.protocolVersion, "2024-11-05");
    assert.equal(resp.result.serverInfo.name, "alfred-memory-mcp");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("handleJsonRpc: tools/list returns all 5 tools", async () => {
  const dir = freshDir();
  try {
    writeConfig(dir);
    const server = createMcpServer({ cwd: dir });
    const resp = await server.handleJsonRpc({ id: 2, method: "tools/list" });
    assert.equal(resp.id, 2);
    assert.equal(resp.result.tools.length, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("handleJsonRpc: tools/call delegates to memory proxy (with fake proxy)", async () => {
  const dir = freshDir();
  try {
    writeConfig(dir);
    const fakeProxy = {
      listMemories: async () => ({ status: 200, body: { items: [{ id: "m1" }], pagination: { total: 1 } } }),
      searchMemories: async () => ({ status: 200, body: { items: [], pagination: { total: 0 } } }),
      createMemory: async () => ({ status: 201, body: { id: "new" } }),
      getMemory: async () => ({ status: 200, body: { id: "m1", content: "hello" } }),
      deleteMemory: async () => ({ status: 200, body: { deleted: true } })
    };
    let captured = null;
    const server = createMcpServer({ cwd: dir, proxyOverride: fakeProxy });
    // Patch handleToolCall to capture args before delegating.
    const original = server.handleToolCall.bind(server);
    server.handleToolCall = async (name, args) => {
      captured = { name, args };
      return { isError: false, content: [{ type: "text", text: "ok" }] };
    };
    const resp = await server.handleJsonRpc({
      id: 3,
      method: "tools/call",
      params: { name: "alfred_create_memory", arguments: { type: "fact", content: "x", source: "test" } }
    });
    assert.equal(captured.name, "alfred_create_memory");
    assert.equal(captured.args.content, "x");
    assert.equal(resp.jsonrpc, "2.0");
    assert.ok("result" in resp);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("handleJsonRpc: unknown method returns -32601", async () => {
  const dir = freshDir();
  try {
    writeConfig(dir);
    const server = createMcpServer({ cwd: dir });
    const resp = await server.handleJsonRpc({ id: 4, method: "made-up" });
    assert.equal(resp.error.code, -32601);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tools/call: alfred_list_memories has correct schema", () => {
  const dir = freshDir();
  try {
    writeConfig(dir);
    const server = createMcpServer({ cwd: dir });
    const tools = server.listTools();
    const t = tools.find((t) => t.name === "alfred_list_memories");
    assert.ok(t);
    assert.equal(t.input_schema.type, "object");
    assert.ok(t.input_schema.properties.namespace);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tools/call: alfred_create_memory requires source field defaults", () => {
  const dir = freshDir();
  try {
    writeConfig(dir);
    const server = createMcpServer({ cwd: dir });
    const tools = server.listTools();
    const t = tools.find((t) => t.name === "alfred_create_memory");
    const required = t.input_schema.required;
    assert.ok(required.includes("type"));
    assert.ok(required.includes("content"));
    assert.ok(required.includes("source"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
