// Anthropic Claude Desktop MCP server (Model Context Protocol).
//
// Claude Desktop reads mcp.json and connects via JSON-RPC over stdio.
// Each tool call here proxies through to the Alfred Memory Server using the
// API key recorded in the workspace config (`cwd/.alfred/config.json`).
//
// Exposed tools:
//   - alfred_list_memories  : list memories for the current tenant
//   - alfred_search_memories: full-text search
//   - alfred_create_memory  : create a memory entry
//   - alfred_get_memory     : fetch a memory by id
//   - alfred_delete_memory  : delete a memory by id
//
// JSON-RPC payloads carry the `id`, `method`, `params` shape. We do not need
// multi-turn handshake; Claude handles initialization on connect.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import http from "node:http";

function readWorkspaceConfig(cwd) {
  const path = join(cwd, ".alfred", "config.json");
  if (!existsSync(path)) {
    throw new Error(`No Alfred config at ${path}. Run 'alfred init' first.`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function fetchJson(url, init = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, init, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }); }
        catch (err) { reject(new Error(`bad json: ${err.message}`)); }
      });
    });
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

function makeProxy(baseUrl, apiKey) {
  return {
    async listMemories(opts = {}) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(opts)) if (v !== undefined) params.set(k, v);
      const url = `${baseUrl.replace(/\/$/, "")}/memories?${params.toString()}`;
      return fetchJson(url, { method: "GET", headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" } });
    },
    async searchMemories(q, opts = {}) {
      const params = new URLSearchParams({ q });
      for (const [k, v] of Object.entries(opts)) if (v !== undefined) params.set(k, v);
      const url = `${baseUrl.replace(/\/$/, "")}/memories/search?${params.toString()}`;
      return fetchJson(url, { method: "GET", headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" } });
    },
    async createMemory(input) {
      const url = `${baseUrl.replace(/\/$/, "")}/memories`;
      return fetchJson(url, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(input)
      });
    },
    async getMemory(id) {
      return fetchJson(`${baseUrl.replace(/\/$/, "")}/memories/${encodeURIComponent(id)}`, {
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" }
      });
    },
    async deleteMemory(id) {
      return fetchJson(`${baseUrl.replace(/\/$/, "")}/memories/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" }
      });
    }
  };
}

export function createMcpServer({ cwd, baseUrl, apiKey, configOverride = null, proxyOverride = null } = {}) {
  const cfg = configOverride || readWorkspaceConfig(cwd);
  const memoryBase = baseUrl || "http://localhost:3000";
  const apiKeyResolved = apiKey || cfg.api_key;
  if (!apiKeyResolved) throw new Error("Missing api key (set ALFRED_MEMORY_API_KEY or include in workspace config).");
  const proxy = proxyOverride || makeProxy(memoryBase, apiKeyResolved);

  const TOOLS = [
    {
      name: "alfred_list_memories",
      description: "List memories from Alfred Memory. Use this for any 'show me what you remember about X' request where X is a topic that may have stored memory entries.",
      input_schema: {
        type: "object",
        properties: {
          namespace: { type: "string" },
          type: { type: "string", enum: ["preference","fact","decision","workflow","project","correction","source"] },
          limit: { type: "integer", minimum: 1, maximum: 100 },
          offset: { type: "integer", minimum: 0 }
        }
      }
    },
    {
      name: "alfred_search_memories",
      description: "Full-text search Alfred Memory. Use this for free-form queries like 'what did we decide about...?' or 'remind me...?'.",
      input_schema: {
        type: "object",
        required: ["q"],
        properties: {
          q: { type: "string" },
          namespace: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 100 }
        }
      }
    },
    {
      name: "alfred_create_memory",
      description: "Persist a durable fact, decision, preference, workflow, project fact, or correction to Alfred Memory.",
      input_schema: {
        type: "object",
        required: ["type", "content", "source"],
        properties: {
          namespace: { type: "string" },
          projectId: { type: "string" },
          type: { type: "string", enum: ["preference","fact","decision","workflow","project","correction","source"] },
          content: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          source: { type: "string", description: "Always set to 'claude-desktop-mcp'" },
          metadata: { type: "object" }
        }
      }
    },
    {
      name: "alfred_get_memory",
      description: "Fetch a single memory entry by id.",
      input_schema: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } }
      }
    },
    {
      name: "alfred_delete_memory",
      description: "Remove a memory entry by id. Use with care — deletion is permanent.",
      input_schema: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } }
      }
    }
  ];

  return {
    listTools() { return TOOLS; },
    async handleToolCall(name, args = {}) {
      const n = String(name);
      if (n === "alfred_list_memories") {
        const r = await proxy.listMemories(args);
        return { isError: r.status >= 400, content: [{ type: "text", text: JSON.stringify(r.body) }] };
      }
      if (n === "alfred_search_memories") {
        const r = await proxy.searchMemories(args.q, args);
        return { isError: r.status >= 400, content: [{ type: "text", text: JSON.stringify(r.body) }] };
      }
      if (n === "alfred_create_memory") {
        const r = await proxy.createMemory({ source: "claude-desktop-mcp", ...args });
        return { isError: r.status >= 400, content: [{ type: "text", text: JSON.stringify(r.body) }] };
      }
      if (n === "alfred_get_memory") {
        const r = await proxy.getMemory(args.id);
        return { isError: r.status >= 400, content: [{ type: "text", text: JSON.stringify(r.body) }] };
      }
      if (n === "alfred_delete_memory") {
        const r = await proxy.deleteMemory(args.id);
        return { isError: r.status >= 400, content: [{ type: "text", text: JSON.stringify(r.body) }] };
      }
      throw new Error(`Unknown tool: ${name}`);
    },

    handleJsonRpc(message) {
      const { id, method, params } = message || {};
      try {
        if (method === "initialize") {
          return jsonRpcResult(id, {
            protocolVersion: "2024-11-05",
            serverInfo: { name: "alfred-memory-mcp", version: "0.3.0" },
            capabilities: { tools: {} }
          });
        }
        if (method === "tools/list") {
          return jsonRpcResult(id, { tools: TOOLS });
        }
        if (method === "tools/call") {
          const name = params?.name;
          const args = params?.arguments || {};
          return this.handleToolCall(name, args).then((res) => jsonRpcResult(id, res));
        }
        if (method === "notifications/initialized" || method === "notifications/cancelled") {
          return null;
        }
        return jsonRpcError(id, -32601, `Method not found: ${method}`);
      } catch (err) {
        return jsonRpcError(id, -32000, err.message);
      }
    }
  };
}

// Stdio main: when run as `node bin/alfred-mcp.mjs`, talk JSON-RPC over stdout/stdin.
function makeStdioRunner() {
  return {
    async run() {
      let config;
      try {
        config = {
          cwd: process.env.ALFRED_WORKSPACE_CWD || process.cwd(),
          baseUrl: process.env.ALFRED_MEMORY_BASE_URL || "http://localhost:3000",
          apiKey: process.env.ALFRED_MEMORY_API_KEY
        };
      } catch (err) {
        process.stderr.write(`init failed: ${err.message}\n`);
        process.exit(1);
      }
      const server = createMcpServer(config);

      let buffer = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", async (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.trim() === "") continue;
          let msg;
          try { msg = JSON.parse(line); } catch (err) {
            process.stdout.write(JSON.stringify(jsonRpcError(null, -32700, "Parse error")) + "\n");
            continue;
          }
          const resp = await server.handleJsonRpc(msg);
          if (resp !== null) process.stdout.write(JSON.stringify(resp) + "\n");
        }
      });
    }
  };
}

export { makeStdioRunner };
