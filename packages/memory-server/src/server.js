// Alfred Memory Server: thin HTTP layer over the registry + per-tenant
// memory stores. Single-process. Stateless between requests.
//
// Wiring:
//   registry (alfred_registry.sqlite) -- maps api_key -> tenant_id and
//                                          stores workspace hierarchy.
//   per-tenant memory stores -- SQLite file per tenant, opened on demand.
//
// Routes:
//   /health      -- liveness
//   /policy      -- registry policy report
//   /memories    -- per-tenant CRUD, scoped by API key
//
// Auth in self-hosted mode: Authorization: Bearer alk_...

import { observeAgentRequest, agentIdentity } from "./agent-activity.js";
import http from "node:http";
import https from "node:https";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const JSON_TYPE = { "content-type": "application/json; charset=utf-8" };

export class ServerConfigError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "ServerConfigError";
    this.code = "server_config_error";
    this.details = details;
  }
}

function booleanFromEnv(value, fallback, name) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw new ServerConfigError(`${name} must be true or false.`);
}

function publicTenant(tenant) {
  if (!tenant) return tenant;
  let metadata = tenant.metadata;
  if (typeof metadata === "string") {
    try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
  }
  return {
    id: tenant.id,
    display_name: tenant.display_name ?? null,
    kind: tenant.kind,
    storage_backend: tenant.storage_backend,
    created_at: tenant.created_at,
    updated_at: tenant.updated_at,
    archived_at: tenant.archived_at ?? null,
    metadata: typeof metadata?.schema === "string" ? { schema: metadata.schema } : {}
  };
}

export function loadServerConfig(env = process.env) {
  const mode = env.ALFRED_MEMORY_HOSTING ?? "local";
  if (!["local", "self-hosted"].includes(mode)) {
    throw new ServerConfigError(`ALFRED_MEMORY_HOSTING must be local or self-hosted, got '${mode}'`);
  }
  const cfg = {
    mode,
    port: Number(env.ALFRED_MEMORY_PORT ?? (mode === "local" ? 3000 : 443)),
    bind: env.ALFRED_MEMORY_BIND ?? (mode === "local" ? "127.0.0.1" : "0.0.0.0"),
    allowedOrigins: (env.ALFRED_MEMORY_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    tlsCert: env.ALFRED_MEMORY_TLS_CERT ?? null,
    tlsKey: env.ALFRED_MEMORY_TLS_KEY ?? null,
    registryPath: env.ALFRED_MEMORY_REGISTRY ?? `${process.env.HOME ?? "/tmp"}/.alfred/registry.sqlite`,
    requireAuth: booleanFromEnv(env.ALFRED_MEMORY_REQUIRE_AUTH, mode === "self-hosted", "ALFRED_MEMORY_REQUIRE_AUTH")
  };
  if (cfg.mode === "self-hosted") {
    if (!cfg.tlsCert || !existsSync(cfg.tlsCert)) {
      throw new ServerConfigError("ALFRED_MEMORY_TLS_CERT must point to a valid cert file in self-hosted mode");
    }
    if (!cfg.tlsKey || !existsSync(cfg.tlsKey)) {
      throw new ServerConfigError("ALFRED_MEMORY_TLS_KEY must point to a valid key file in self-hosted mode");
    }
  }
  return cfg;
}

function json(res, status, body) {
  res.writeHead(status, JSON_TYPE);
  res.end(JSON.stringify(body) + "\n");
}

function authenticate(req, cfg, userService) {
  const auth = req.headers.authorization;
  const apiKey = typeof auth === "string" && auth.startsWith("Bearer ")
    ? auth.slice("Bearer ".length).trim()
    : (typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : null);
  if (!cfg.requireAuth) {
    return { apiKey: apiKey || "loopback-anonymous" };
  }
  if (!apiKey) return { error: { code: "unauthorized", message: "API key required." } };
  return { apiKey };
}

export function createApp({
  userService,
  getMemoryService,    // async (tenantId) => MemoryService
  tenantService,
  config,
  consoleRouter,        // optional: created via createConsoleRouter
  openapiRouter,        // optional: created via createOpenapiRouter (v0.4.1)
  oauthRouter,          // optional: OAuth 2.0 authorization/token endpoints
  mcpRouter,            // optional: remote Streamable HTTP MCP + discovery
  agentActivity = null,
  registry = null       // v0.3.1: pass-through for /console/api/bootstrap
}) {
  return async function app(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (config?.mode === "self-hosted") {
      const origin = req.headers.origin;
      if (origin && (config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin))) {
        res.setHeader("access-control-allow-origin", origin);
        res.setHeader("vary", "Origin");
        res.setHeader("access-control-allow-headers", "content-type, x-api-key, authorization");
        res.setHeader("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
    }

    if (url.pathname === "/health") {
      if (req.method !== "GET") return json(res, 405, { error: { code: "method_not_allowed" } });
      return json(res, 200, { status: "ok", mode: config?.mode ?? "local" });
    }

    if (url.pathname === "/policy") {
      if (req.method !== "GET") return json(res, 405, { error: { code: "method_not_allowed" } });
      try {
        const report = await tenantService.validatePolicy();
        return json(res, 200, report);
      } catch (err) {
        return json(res, 500, { error: { code: "internal_error", message: err.message } });
      }
    }

    if (oauthRouter && (
      url.pathname.startsWith("/oauth/") ||
      url.pathname === "/.well-known/oauth-authorization-server"
    )) {
      return oauthRouter(req, res);
    }

    if (mcpRouter && (
      url.pathname === "/mcp" ||
      url.pathname === "/.well-known/oauth-protected-resource" ||
      url.pathname === "/.well-known/oauth-protected-resource/mcp" ||
      url.pathname === "/.well-known/openai-apps-challenge"
    )) {
      return mcpRouter(req, res);
    }

    if (openapiRouter && (
      url.pathname === "/health" ||
      url.pathname === "/privacy" ||
      url.pathname === "/agents/manifest" ||
      url.pathname === "/skills/manifest" ||
      url.pathname === "/openapi.yaml" ||
      url.pathname === "/policies/check" ||
      url.pathname === "/search" ||
      url.pathname === "/memories" ||
      url.pathname.startsWith("/memories/")
    )) {
      return openapiRouter(req, res);
    }

    if (url.pathname === "/tenants") {
      if (req.method !== "GET") return json(res, 405, { error: { code: "method_not_allowed" } });
      try {
        if (config?.requireAuth) {
          const auth = authenticate(req, config, userService);
          if (auth.error) return json(res, 401, { error: auth.error });
          const resolved = await userService.resolveApiKey(auth.apiKey);
          if (!resolved) return json(res, 401, { error: { code: "unauthorized", message: "Invalid or revoked API key." } });
          const tenant = await tenantService.getTenant(resolved.tenant_id);
          return json(res, 200, {
            items: [publicTenant(tenant)],
            pagination: { limit: 1, offset: 0, total: 1 }
          });
        }
        const result = await tenantService.listTenants({});
        return json(res, 200, { ...result, items: result.items.map(publicTenant) });
      } catch (err) {
        return json(res, err?.status || 500, { error: { code: err?.code || "internal_error", message: err?.message || "Alfred could not list tenants." } });
      }
    }

    if (url.pathname === "/memories" || url.pathname.startsWith("/memories/")) {
      const auth = authenticate(req, config ?? { requireAuth: true }, userService);
      if (auth.error) return json(res, 401, { error: auth.error });
      if (!auth.apiKey) return json(res, 401, { error: { code: "unauthorized" } });

      let tenantId = "loopback-anonymous";
      let resolved = null;
      if (config?.requireAuth) {
        resolved = await userService.resolveApiKey(auth.apiKey);
        if (!resolved) return json(res, 401, { error: { code: "unauthorized", message: "Invalid API key." } });
        tenantId = resolved.tenant_id;
      }

      const finishActivity = resolved ? observeAgentRequest(agentActivity, agentIdentity(resolved, "http"), req, res) : () => {};
      let memoryService;
      try {
        memoryService = await getMemoryService(tenantId);
      } catch (err) {
        finishActivity("failed");
        return json(res, 404, { error: { code: "tenant_not_found", message: err.message } });
      }

      try {
        return await handleMemoriesRoute(memoryService, tenantId, req, res, url);
      } finally {
        finishActivity(res.statusCode >= 400 ? "failed" : "completed");
      }
    }

    return json(res, 404, { error: { code: "not_found", message: "Route not found." } });
  };
}

async function handleMemoriesRoute(service, tenantId, req, res, url) {
  const segs = url.pathname.split("/").filter(Boolean);

  async function readJson() {
    if (req.method === "GET" || req.method === "DELETE") return {};
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (raw.trim() === "") return {};
    try {
      return JSON.parse(raw);
    } catch {
      json(res, 400, { error: { code: "validation_error", message: "Invalid JSON body." } });
      return undefined;
    }
  }

  if (segs.length === 1) {
    if (req.method === "POST") {
      const body = await readJson();
      if (body === undefined) return;
      try {
        const m = await service.createMemory(tenantId, body);
        return json(res, 201, m);
      } catch (err) {
        return json(res, err.status || 400, { error: { code: err.code || "validation_error", message: err.message, details: err.details } });
      }
    }
    if (req.method === "GET") {
      const opts = {};
      for (const k of ["limit", "offset", "type", "namespace", "tag", "q"]) {
        if (url.searchParams.has(k)) opts[k] = url.searchParams.get(k);
      }
      try {
        const result = opts.q
          ? await service.searchMemories(tenantId, opts)
          : await service.listMemories(tenantId, opts);
        return json(res, 200, result);
      } catch (err) {
        return json(res, err.status || 500, { error: { code: err.code || "internal_error", message: err.message } });
      }
    }
    return json(res, 405, { error: { code: "method_not_allowed" } });
  }

  if (segs.length === 2 && segs[1] === "search") {
    if (req.method !== "GET") return json(res, 405, { error: { code: "method_not_allowed" } });
    const opts = { q: url.searchParams.get("q") };
    for (const k of ["limit", "offset", "type", "namespace", "tag"]) {
      if (url.searchParams.has(k)) opts[k] = url.searchParams.get(k);
    }
    try {
      const result = await service.searchMemories(tenantId, opts);
      return json(res, 200, result);
    } catch (err) {
      return json(res, err.status || 500, { error: { code: err.code || "internal_error", message: err.message } });
    }
  }

  if (segs.length === 2 && segs[1] !== "search") {
    const id = decodeURIComponent(segs[1]);
    if (req.method === "GET") {
      try {
        const m = await service.getMemory(tenantId, id);
        return json(res, 200, m);
      } catch (err) {
        return json(res, err.status || 404, { error: { code: err.code || "not_found", message: err.message } });
      }
    }
    if (req.method === "PATCH") {
      const body = await readJson();
      if (body === undefined) return;
      try {
        const m = await service.updateMemory(tenantId, id, body);
        return json(res, 200, m);
      } catch (err) {
        return json(res, err.status || 400, { error: { code: err.code || "validation_error", message: err.message, details: err.details } });
      }
    }
    if (req.method === "DELETE") {
      try {
        await service.deleteMemory(tenantId, id);
        return json(res, 200, { deleted: true });
      } catch (err) {
        return json(res, err.status || 404, { error: { code: err.code || "not_found", message: err.message } });
      }
    }
  }

  return json(res, 404, { error: { code: "not_found" } });
}

function consoleHandler(config, consoleRouter, fallbackApp) {
  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/console" || url.pathname === "/console/" || url.pathname.startsWith("/console/api/")) {
      try {
        await consoleRouter(req, res);
        return;
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "internal_error", message: err.message } }) + "\n");
        return;
      }
    }
    return fallbackApp(req, res);
  };
}

function serverHandler(config, app) {
  if (config.mode === "self-hosted") {
    const tls = { cert: readFileSync(config.tlsCert), key: readFileSync(config.tlsKey) };
    return https.createServer(tls, app);
  }
  return http.createServer(app);
}

function serverHandlerWithConsole(config, app, consoleRouter) {
  if (!consoleRouter) return serverHandler(config, app);
  return serverHandler(config, consoleHandler(config, consoleRouter, app));
}

export function createServer({ app, config, consoleRouter, registry = null } = {}) {
  // createServer is intentionally sync. Console router wiring is the
  // caller's responsibility (pass consoleRouter explicitly) because the
  // console-router module is async-imported at the top of serve.mjs anyway.
  return serverHandlerWithConsole(config, app, consoleRouter);
}

export function startServer({ app, config, consoleRouter, registry = null } = {}) {
  let effectiveRouter = consoleRouter;
  if (registry && !effectiveRouter) {
    // Lazy: same default as createServer.
    import("./console-router.js").then(({ createConsoleRouter }) => {
      // Note: this path is sync from the caller's perspective; we resolve
      // the router inline at boot.
    });
  }
  const server = serverHandlerWithConsole(config, app, effectiveRouter);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.bind, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}
