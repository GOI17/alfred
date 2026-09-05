// Keep the source import explicit like the server's existing memory-domain
// wiring. The workspace dependency in package.json ensures the MCP SDK and Zod
// are included in production-only installs.
import { createMemoryMcpServer } from "../../memory-mcp/src/index.js";

const JSON_TYPE = "application/json; charset=utf-8";
const MCP_SCOPES = Object.freeze(["memory:read", "memory:write"]);

export function createMcpRouter({
  oauthService = null,
  getMemoryService,
  publicUrl,
  challengeToken = null,
  serverFactory = createMemoryMcpServer,
  transportFactory = defaultTransportFactory,
  trace = null
} = {}) {
  if (typeof getMemoryService !== "function") {
    throw new TypeError("createMcpRouter requires getMemoryService.");
  }
  const origin = normalizedOrigin(publicUrl);
  const resource = `${origin}/mcp`;
  const metadataPath = "/.well-known/oauth-protected-resource/mcp";
  const metadataUrl = `${origin}${metadataPath}`;

  return async function mcpRouter(req, res) {
    const url = new URL(req.url ?? "/", origin);

    if (
      url.pathname === metadataPath ||
      url.pathname === "/.well-known/oauth-protected-resource"
    ) {
      if (req.method !== "GET") return jsonRpcMethodNotAllowed(res);
      return json(res, 200, {
        resource,
        authorization_servers: [origin],
        scopes_supported: MCP_SCOPES,
        resource_documentation: "https://alfred.alfredlabs.org/docs/memory.html",
        resource_policy_uri: `${origin}/privacy`,
        resource_tos_uri: "https://alfred.alfredlabs.org/terms/"
      }, { "cache-control": "public, max-age=300" });
    }

    if (url.pathname === "/.well-known/openai-apps-challenge") {
      if (req.method !== "GET") return jsonRpcMethodNotAllowed(res);
      if (!challengeToken) return json(res, 404, { error: { code: "not_found" } });
      res.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      });
      return res.end(challengeToken);
    }

    if (url.pathname !== "/mcp") return json(res, 404, { error: { code: "not_found" } });
    if (req.method !== "POST") return jsonRpcMethodNotAllowed(res);
    if (!oauthService) {
      return json(res, 503, jsonRpcError(-32000, "OAuth is not configured."));
    }

    const token = bearerToken(req.headers.authorization);
    const resolved = token ? await oauthService.resolveAccessToken(token, { resource }) : null;
    if (!resolved || resolved.resource !== resource) {
      return unauthorized(res, metadataUrl, "invalid_token", "A valid Alfred OAuth access token is required.");
    }

    let memoryService;
    try {
      memoryService = await getMemoryService(resolved.tenant_id);
    } catch {
      await emitTrace(trace, {
        tenant_id: resolved.tenant_id,
        event: "mcp.request_failed",
        payload: { reason: "tenant_unavailable", provider_calls: 0 }
      });
      return json(res, 503, jsonRpcError(-32603, "Alfred Memory is temporarily unavailable."));
    }

    const challenge = bearerChallenge(metadataUrl, "insufficient_scope", "Reconnect Alfred with the required permission.");
    const memoryClient = memoryClientForTenant(memoryService, resolved.tenant_id, resolved.scopes, challenge);
    let server = null;
    let transport = null;
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await Promise.allSettled([
        typeof transport?.close === "function" ? transport.close() : undefined,
        typeof server?.close === "function" ? server.close() : undefined
      ]);
    };

    if (typeof res.on === "function") res.on("close", () => { void close(); });

    let stage = "server_factory";
    try {
      server = await serverFactory({ memoryClient });
      stage = "transport_factory";
      transport = await transportFactory();
      stage = "server_connect";
      await server.connect(transport);
      stage = "request";
      await transport.handleRequest(req, res);
      await emitTrace(trace, {
        tenant_id: resolved.tenant_id,
        event: "mcp.request_completed",
        payload: { provider_calls: 0 }
      });
    } catch {
      await emitTrace(trace, {
        tenant_id: resolved.tenant_id,
        event: "mcp.request_failed",
        payload: { reason: "transport_error", stage, provider_calls: 0 }
      });
      if (!res.headersSent) {
        json(res, 500, jsonRpcError(-32603, "Alfred could not complete the MCP request."), {
          "x-alfred-mcp-error-stage": stage
        });
      }
    } finally {
      if (res.writableEnded || typeof res.on !== "function") await close();
    }
  };
}

export function memoryClientForTenant(memoryService, tenantId, scopes = [], challenge = "") {
  if (!memoryService || typeof memoryService !== "object") {
    throw new TypeError("memoryClientForTenant requires a memory service.");
  }
  const granted = new Set(scopes);
  const requireScope = (scope) => {
    if (granted.has(scope)) return;
    const error = new Error(`OAuth scope ${scope} is required.`);
    error.name = "MemoryClientError";
    error.code = "insufficient_scope";
    error.status = 403;
    error.mcpChallenge = challenge;
    throw error;
  };

  return {
    searchMemories(input) {
      requireScope("memory:read");
      return memoryService.searchMemories(tenantId, input);
    },
    createMemory(input) {
      requireScope("memory:write");
      return memoryService.createMemory(tenantId, input);
    },
    updateMemory(id, patch) {
      requireScope("memory:write");
      return memoryService.updateMemory(tenantId, id, patch);
    },
    deleteMemory(id) {
      requireScope("memory:write");
      return memoryService.deleteMemory(tenantId, id);
    },
    listMemories(input) {
      requireScope("memory:read");
      return memoryService.listMemories(tenantId, input);
    }
  };
}

async function defaultTransportFactory() {
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  return new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
}

function bearerToken(value) {
  if (typeof value !== "string") return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(value.trim());
  return match?.[1] ?? null;
}

function normalizedOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError("createMcpRouter requires a valid publicUrl."); }
  if (!(["https:", "http:"].includes(url.protocol))) throw new TypeError("publicUrl must use HTTP or HTTPS.");
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new TypeError("publicUrl must be an origin without a path, credentials, query, or fragment.");
  }
  return url.origin;
}

function bearerChallenge(metadataUrl, error, description) {
  return `Bearer resource_metadata="${metadataUrl}", scope="${MCP_SCOPES.join(" ")}", error="${error}", error_description="${description}"`;
}

function unauthorized(res, metadataUrl, error, description) {
  return json(res, 401, jsonRpcError(-32001, description), {
    "www-authenticate": bearerChallenge(metadataUrl, error, description),
    "cache-control": "no-store"
  });
}

function jsonRpcMethodNotAllowed(res) {
  return json(res, 405, jsonRpcError(-32000, "Method not allowed."), { allow: "POST" });
}

function jsonRpcError(code, message) {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": JSON_TYPE, ...headers });
  res.end(`${JSON.stringify(body)}\n`);
}

async function emitTrace(trace, event) {
  if (typeof trace !== "function") return;
  try { await trace(event); } catch {}
}
