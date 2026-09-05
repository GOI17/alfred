import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createMcpRouter, memoryClientForTenant } from "../src/mcp-router.js";

function request({ method = "GET", url = "/", authorization } = {}) {
  return {
    method,
    url,
    headers: authorization ? { authorization } : {},
    async *[Symbol.asyncIterator]() {}
  };
}

function response() {
  const listeners = new Map();
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    headersSent: false,
    writableEnded: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headersSent = true;
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    },
    end(chunk = "") {
      if (chunk) this.chunks.push(String(chunk));
      this.body = this.chunks.join("");
      this.writableEnded = true;
      for (const listener of listeners.get("close") ?? []) listener();
    },
    on(name, listener) {
      const current = listeners.get(name) ?? [];
      current.push(listener);
      listeners.set(name, current);
    }
  };
}

function router(overrides = {}) {
  return createMcpRouter({
    publicUrl: "https://memory.example.test",
    oauthService: { async resolveAccessToken() { return null; } },
    async getMemoryService() { return {}; },
    ...overrides
  });
}

test("publishes path-specific MCP protected-resource metadata without authentication", async () => {
  const handler = router();
  const res = response();

  await handler(request({ url: "/.well-known/oauth-protected-resource/mcp" }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "public, max-age=300");
  assert.deepEqual(JSON.parse(res.body), {
    resource: "https://memory.example.test/mcp",
    authorization_servers: ["https://memory.example.test"],
    scopes_supported: ["memory:read", "memory:write"],
    resource_documentation: "https://alfred.alfredlabs.org/docs/memory.html",
    resource_policy_uri: "https://memory.example.test/privacy",
    resource_tos_uri: "https://alfred.alfredlabs.org/terms/"
  });
});

test("preserves the generic protected-resource metadata URL as a compatibility alias", async () => {
  const handler = router();
  const res = response();

  await handler(request({ url: "/.well-known/oauth-protected-resource" }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).resource, "https://memory.example.test/mcp");
});

test("serves the OpenAI domain challenge only when configured", async () => {
  const missing = response();
  await router()(request({ url: "/.well-known/openai-apps-challenge" }), missing);
  assert.equal(missing.statusCode, 404);

  const configured = response();
  await router({ challengeToken: "openai-domain-proof" })(
    request({ url: "/.well-known/openai-apps-challenge" }),
    configured
  );
  assert.equal(configured.statusCode, 200);
  assert.equal(configured.body, "openai-domain-proof");
  assert.equal(configured.headers["cache-control"], "no-store");
});

test("rejects unauthenticated MCP requests with protected-resource discovery", async () => {
  const res = response();

  await router()(request({ method: "POST", url: "/mcp" }), res);

  assert.equal(res.statusCode, 401);
  assert.match(res.headers["www-authenticate"], /^Bearer resource_metadata="https:\/\/memory\.example\.test\/\.well-known\/oauth-protected-resource\/mcp"/);
  assert.equal(JSON.parse(res.body).error.code, -32001);
});

test("connects one stateless MCP server and transport for an authenticated request", async () => {
  const events = [];
  let connectedTransport;
  let receivedRequest;
  let closedServer = false;
  let closedTransport = false;
  let receivedClient;
  const transport = {
    async handleRequest(req, res) {
      receivedRequest = req;
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"jsonrpc":"2.0","result":{},"id":1}');
    },
    async close() { closedTransport = true; }
  };
  const handler = router({
    oauthService: {
      async resolveAccessToken(token, options) {
        assert.equal(token, "alo_valid");
        assert.deepEqual(options, { resource: "https://memory.example.test/mcp" });
        return { tenant_id: "tenant-1", scopes: ["memory:read"], resource: "https://memory.example.test/mcp" };
      }
    },
    async getMemoryService(tenantId) {
      assert.equal(tenantId, "tenant-1");
      return {};
    },
    async serverFactory({ memoryClient }) {
      receivedClient = memoryClient;
      return {
        async connect(value) { connectedTransport = value; },
        async close() { closedServer = true; }
      };
    },
    async transportFactory() { return transport; },
    async trace(event) { events.push(event); }
  });
  const req = request({ method: "POST", url: "/mcp", authorization: "Bearer alo_valid" });
  const res = response();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(receivedRequest, req);
  assert.equal(connectedTransport, transport);
  assert.equal(typeof receivedClient.listMemories, "function");
  assert.equal(closedServer, true);
  assert.equal(closedTransport, true);
  assert.equal(events.at(-1).event, "mcp.request_completed");
  assert.equal(events.at(-1).payload.provider_calls, 0);
});

test("request-scoped memory client enforces scopes and tenant identity", async () => {
  const calls = [];
  const service = {
    async listMemories(...args) { calls.push(["list", ...args]); return { items: [] }; },
    async createMemory(...args) { calls.push(["create", ...args]); return { id: "mem-1" }; }
  };
  const readClient = memoryClientForTenant(service, "tenant-1", ["memory:read"], "Bearer challenge");

  await readClient.listMemories({ limit: 2 });
  assert.deepEqual(calls, [["list", "tenant-1", { limit: 2 }]]);
  assert.throws(
    () => readClient.createMemory({ content: "blocked" }),
    (error) => error.code === "insufficient_scope" && error.mcpChallenge === "Bearer challenge"
  );
});

test("GET and DELETE on /mcp return protocol method errors", async () => {
  for (const method of ["GET", "DELETE"]) {
    const res = response();
    await router()(request({ method, url: "/mcp" }), res);
    assert.equal(res.statusCode, 405);
    assert.equal(JSON.parse(res.body).error.code, -32000);
  }
});

test("real MCP SDK initializes, lists annotated tools, and calls a tenant-scoped tool over HTTP", async () => {
  const calls = [];
  let origin;
  const service = {
    async searchMemories(tenantId, input) {
      calls.push({ method: "search", tenantId, input });
      return {
        items: [{ id: "mem-1", content: input.q }],
        pagination: { limit: 1, offset: 0, total: 1 }
      };
    },
    async createMemory() { throw new Error("not used"); },
    async updateMemory() { throw new Error("not used"); },
    async deleteMemory() { throw new Error("not used"); },
    async listMemories() {
      return { items: [], pagination: { limit: 20, offset: 0, total: 0 } };
    }
  };
  const nodeServer = http.createServer((req, res) => handler(req, res));
  const handler = createMcpRouter({
    get publicUrl() { return origin ?? "http://127.0.0.1"; },
    oauthService: {
      async resolveAccessToken(token, { resource }) {
        if (token !== "alo_sdk_test" || resource !== `${origin}/mcp`) return null;
        return { tenant_id: "tenant-sdk", scopes: ["memory:read"], resource };
      }
    },
    async getMemoryService() { return service; }
  });
  await new Promise((resolve, reject) => {
    nodeServer.listen(0, "127.0.0.1", resolve);
    nodeServer.on("error", reject);
  });
  const address = nodeServer.address();
  origin = `http://127.0.0.1:${address.port}`;

  // Recreate after the ephemeral origin is known because protected-resource
  // identity is intentionally immutable for the router lifetime.
  const liveHandler = createMcpRouter({
    publicUrl: origin,
    oauthService: {
      async resolveAccessToken(token, { resource }) {
        if (token !== "alo_sdk_test" || resource !== `${origin}/mcp`) return null;
        return { tenant_id: "tenant-sdk", scopes: ["memory:read"], resource };
      }
    },
    async getMemoryService() { return service; }
  });
  nodeServer.removeAllListeners("request");
  nodeServer.on("request", liveHandler);

  const client = new Client({ name: "alfred-memory-test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    requestInit: { headers: { authorization: "Bearer alo_sdk_test" } }
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), [
      "memory_search", "memory_create", "memory_update", "memory_delete", "memory_list"
    ]);
    const search = listed.tools.find((tool) => tool.name === "memory_search");
    const deletion = listed.tools.find((tool) => tool.name === "memory_delete");
    assert.equal(search.annotations.readOnlyHint, true);
    assert.deepEqual(search._meta.securitySchemes, [{ type: "oauth2", scopes: ["memory:read"] }]);
    assert.equal(deletion.annotations.destructiveHint, true);

    const result = await client.callTool({ name: "memory_search", arguments: { q: "MCP over HTTP", limit: 1 } });
    assert.equal(result.structuredContent.items[0].content, "MCP over HTTP");
    assert.deepEqual(calls, [{
      method: "search",
      tenantId: "tenant-sdk",
      input: { q: "MCP over HTTP", limit: 1 }
    }]);
  } finally {
    await client.close().catch(() => undefined);
    await new Promise((resolve) => nodeServer.close(resolve));
  }
});
