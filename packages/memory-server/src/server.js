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
    requireAuth: mode === "self-hosted"
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
  consoleRouter         // optional: created via createConsoleRouter
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

    if (url.pathname === "/tenants") {
      if (req.method !== "GET") return json(res, 405, { error: { code: "method_not_allowed" } });
      const result = await tenantService.listTenants({});
      return json(res, 200, result);
    }

    if (url.pathname === "/memories" || url.pathname.startsWith("/memories/")) {
      const auth = authenticate(req, config ?? { requireAuth: true }, userService);
      if (auth.error) return json(res, 401, { error: auth.error });
      if (!auth.apiKey) return json(res, 401, { error: { code: "unauthorized" } });

      let tenantId = "loopback-anonymous";
      if (config?.requireAuth) {
        const resolved = await userService.resolveApiKey(auth.apiKey);
        if (!resolved) return json(res, 401, { error: { code: "unauthorized", message: "Invalid API key." } });
        tenantId = resolved.tenant_id;
      }

      let memoryService;
      try {
        memoryService = await getMemoryService(tenantId);
      } catch (err) {
        return json(res, 404, { error: { code: "tenant_not_found", message: err.message } });
      }

      return handleMemoriesRoute(memoryService, tenantId, req, res, url);
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

export function createServer({ app, config, consoleRouter } = {}) {
  return serverHandlerWithConsole(config, app, consoleRouter);
}

export function startServer({ app, config, consoleRouter } = {}) {
  const server = serverHandlerWithConsole(config, app, consoleRouter);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.bind, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}
