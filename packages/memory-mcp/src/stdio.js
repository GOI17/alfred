import { createInterface } from "node:readline";

import {
  MEMORY_MCP_INSTRUCTIONS,
  MEMORY_MCP_SERVER_INFO,
  createPlainSchemaAdapter,
  registerMemoryTools
} from "./server.js";

const MEMORY_TYPES = ["preference", "fact", "decision", "workflow", "project", "correction", "source"];

const attributionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["harness", "actor", "reason"],
  properties: {
    harness: { type: "string", minLength: 1 },
    actor: { type: "string", minLength: 1 },
    reason: { type: "string", minLength: 1 },
    sessionId: { type: "string", minLength: 1 }
  }
};

const listProperties = {
  limit: { type: "number", minimum: 1 },
  offset: { type: "number", minimum: 0 },
  type: { type: "string", enum: MEMORY_TYPES },
  namespace: { type: "string", minLength: 1 },
  projectId: { type: "string", minLength: 1 },
  tag: { type: "string", minLength: 1 },
  harness: { type: "string", minLength: 1 }
};

const toolInputSchemas = Object.freeze({
  memory_search: {
    type: "object",
    additionalProperties: false,
    required: ["q"],
    properties: { q: { type: "string", minLength: 1 }, ...listProperties }
  },
  memory_create: {
    type: "object",
    additionalProperties: false,
    required: ["type", "content", "source", "attribution"],
    properties: {
      namespace: { type: "string", minLength: 1 },
      type: { type: "string", enum: MEMORY_TYPES },
      content: { type: "string", minLength: 1 },
      tags: { type: "array", items: { type: "string", minLength: 1 } },
      source: { type: "string", minLength: 1 },
      projectId: { type: "string", minLength: 1 },
      metadata: { type: "object", additionalProperties: true },
      attribution: attributionSchema,
      confidence: { type: "number" },
      expiresAt: { type: "string", minLength: 1 }
    }
  },
  memory_update: {
    type: "object",
    additionalProperties: false,
    required: ["id", "patch"],
    properties: {
      id: { type: "string", minLength: 1 },
      patch: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: MEMORY_TYPES },
          content: { type: "string", minLength: 1 },
          tags: { type: "array", items: { type: "string", minLength: 1 } },
          source: { type: "string", minLength: 1 },
          projectId: { type: ["string", "null"] },
          metadata: { type: ["object", "null"], additionalProperties: true },
          attribution: { anyOf: [attributionSchema, { type: "null" }] },
          confidence: { type: ["number", "null"] },
          expiresAt: { type: ["string", "null"] }
        }
      }
    }
  },
  memory_delete: {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: { type: "string", minLength: 1 } }
  },
  memory_list: {
    type: "object",
    additionalProperties: false,
    properties: listProperties
  }
});

export function createStandaloneMcpProtocol({
  memoryClient,
  serverInfo = MEMORY_MCP_SERVER_INFO,
  instructions = MEMORY_MCP_INSTRUCTIONS
} = {}) {
  const registered = [];
  registerMemoryTools({
    registerTool(name, config, handler) {
      registered.push({ name, config, handler });
    }
  }, { memoryClient, schema: createPlainSchemaAdapter() });
  const byName = new Map(registered.map((entry) => [entry.name, entry]));
  const tools = registered.map(({ name, config }) => ({
    name,
    title: config.title,
    description: config.description,
    inputSchema: toolInputSchemas[name]
  }));

  return {
    tools,
    async handle(message) {
      const id = message?.id ?? null;
      if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
        return rpcError(id, -32600, "Invalid Request");
      }
      if (message.id === undefined) return null;

      if (message.method === "initialize") {
        return rpcResult(id, {
          protocolVersion: message.params?.protocolVersion || "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo,
          instructions
        });
      }
      if (message.method === "ping") return rpcResult(id, {});
      if (message.method === "tools/list") return rpcResult(id, { tools });
      if (message.method === "tools/call") {
        const name = message.params?.name;
        const entry = byName.get(name);
        if (!entry) return rpcError(id, -32602, `Unknown tool '${name ?? ""}'.`);
        const result = await entry.handler(message.params?.arguments ?? {});
        return rpcResult(id, result);
      }
      return rpcError(id, -32601, "Method not found");
    }
  };
}

export async function runStandaloneMcpStdio({
  memoryClient,
  input = process.stdin,
  output = process.stdout,
  serverInfo,
  instructions
} = {}) {
  const protocol = createStandaloneMcpProtocol({ memoryClient, serverInfo, instructions });
  const lines = createInterface({ input, crlfDelay: Infinity, terminal: false });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let response;
    try {
      response = await protocol.handle(JSON.parse(line));
    } catch {
      response = rpcError(null, -32700, "Parse error");
    }
    if (response) output.write(`${JSON.stringify(response)}\n`);
  }
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
