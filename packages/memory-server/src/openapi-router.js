// Custom GPT / OpenAPI surface router. Exposes the read+write actions that
// a Custom GPT (or any OpenAPI 3.1 consumer) can call against Alfred Memory.
//
// Endpoints (all relative to /):
//   GET  /health                  -- public (no auth), used by GPT healthcheck
//   GET  /agents/manifest         -- public, returns the 6 agents from
//                                    .ai/agents/registry.json
//   GET  /skills/manifest         -- public, returns the skill catalog from
//                                    .ai/skills/registry.json
//   POST /policies/check          -- public, returns whether a proposed action
//                                    is allowed under current policy
//   GET  /memories                -- auth, list
//   POST /memories                -- auth, create
//   GET  /memories/{id}           -- auth, read one
//   PATCH /memories/{id}          -- auth, update
//   DELETE /memories/{id}         -- auth, delete
//   POST /search                  -- auth, semantic/keyword/hybrid search
//                                    (delegates to createSearchService)
//
// Rate limit: 100 req/min per API key (action-rate-limiter).
// All mutators are x-openai-isConsequential:true in the OpenAPI spec.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createActionRateLimiter } from "./bootstrap/action-rate-limiter.js";

const here = dirname(fileURLToPath(import.meta.url));

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body) + "\n");
}

function authenticate(req) {
  const auth = req.headers.authorization;
  const apiKey = typeof auth === "string" && auth.startsWith("Bearer ")
    ? auth.slice("Bearer ".length).trim()
    : (typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : null);
  if (!apiKey) return { error: { code: "unauthorized", message: "API key required." } };
  return { apiKey };
}

function hashKey(apiKey) {
  return createHash("sha256").update(apiKey).digest("hex");
}

async function readJsonBody(req) {
  if (req.method === "GET" || req.method === "DELETE") return {};
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") return {};
  try { return JSON.parse(raw); }
  catch { return { __invalid: true }; }
}

// ---- Manifest loaders --------------------------------------------------------

function loadAgentsManifest(projectRoot) {
  // projectRoot is the repo root; the agents registry lives at .ai/agents/registry.json
  const p = join(projectRoot, ".ai", "agents", "registry.json");
  if (!existsSync(p)) return { agents: [], source: null, error: "registry_missing" };
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    return {
      agents: (raw.agents ?? []).map((a) => ({
        id: a.id,
        role: a.role,
        permission_profile: a.permission_profile,
        status: a.status,
        phase: a.phase ?? null,
        spec: a.spec
      })),
      source: p,
      count: (raw.agents ?? []).length
    };
  } catch (err) {
    return { agents: [], source: p, error: err.message };
  }
}

function loadSkillsManifest(projectRoot) {
  const p = join(projectRoot, ".ai", "skills", "registry.json");
  if (!existsSync(p)) return { skills: [], source: null, error: "registry_missing" };
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    return {
      skills: (raw.skills ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        triggers: s.triggers ?? [],
        scope: s.scope,
        source: s.source,
        allowed_agents: s.allowedAgents ?? []
      })),
      source: p,
      count: (raw.skills ?? []).length
    };
  } catch (err) {
    return { skills: [], source: p, error: err.message };
  }
}

// ---- Policy check ------------------------------------------------------------

// Conservative v0.4.1 implementation. The /policies/check endpoint
// rejects a small set of obviously forbidden actions and delegates the
// rest to the caller (who is, in practice, the Custom GPT's system
// prompt). It is intentionally not a full policy engine — that is the
// v0.5.0 work. This endpoint exists so the GPT can ask "is X allowed?"
// before doing it, which reduces the rate of accidental 4xx responses.

const FORBIDDEN_ACTIONS = new Set([
  "delete_all_tenants",
  "rotate_all_keys",
  "drop_registry",
  "bypass_rate_limit",
  "read_other_tenant_data",
  "execute_local_command"
]);

const ALLOWED_NAMESPACES = new Set([
  "personal", "project", "workflow", "decision", "preference", "fact", "correction", "source"
]);

function checkPolicy({ action, target, context }) {
  if (typeof action !== "string" || action === "") {
    return { allowed: false, reason: "action_required" };
  }
  if (FORBIDDEN_ACTIONS.has(action)) {
    return { allowed: false, reason: "forbidden_action", action };
  }
  // Per-tenant data is the only kind the GPT should ever read/write.
  if (target && typeof target === "object") {
    if (target.tenant_id && context?.tenant_id && target.tenant_id !== context.tenant_id) {
      return { allowed: false, reason: "cross_tenant_access" };
    }
    if (target.namespace && !ALLOWED_NAMESPACES.has(target.namespace.split(":")[0])) {
      return { allowed: false, reason: "unknown_namespace", namespace: target.namespace };
    }
  }
  return { allowed: true, reason: "ok" };
}

// ---- Router ------------------------------------------------------------------

export function createOpenapiRouter({
  userService,           // required for /memories, /search auth
  getMemoryService,      // async (tenantId) => MemoryService
  searchServiceFactory,  // () => SearchService (lazy, so we don't load transformers at startup)
  projectRoot,           // repo root for manifest loaders
  registry = null,       // optional; if provided, rate limiter is enabled
  requireAuth = true
} = {}) {
  if (!userService) throw new TypeError("createOpenapiRouter requires userService");
  if (typeof getMemoryService !== "function") throw new TypeError("createOpenapiRouter requires getMemoryService");
  if (!projectRoot) throw new TypeError("createOpenapiRouter requires projectRoot");

  const rateLimiter = registry ? createActionRateLimiter({ registry }) : null;
  const agentsManifest = loadAgentsManifest(projectRoot);
  const skillsManifest = loadSkillsManifest(projectRoot);

  // Cached at router creation; if .ai/ changes at runtime, restart the
  // process. This is fine for v0.4.1 (manifests change per release).

  async function enforceRateLimit(apiKey, endpoint, method) {
    if (!rateLimiter) return { allowed: true };
    const apiKeyHash = hashKey(apiKey);
    const check = await rateLimiter.check({ apiKeyHash });
    if (!check.allowed) {
      return {
        allowed: false,
        status: 429,
        body: {
          error: {
            code: "rate_limited",
            message: "Action rate limit exceeded. Try again later.",
            retry_after_seconds: check.retryAfterSeconds
          }
        }
      };
    }
    // Record after response (deferred to caller via the returned fn).
    return {
      allowed: true,
      remaining: check.remaining,
      record: (result, errorCode) =>
        rateLimiter.record({ apiKeyHash, endpoint, method, result, errorCode })
    };
  }

  return async function openapiHandler(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");

    // CORS for browser-based GPT testers
    if (url.pathname.startsWith("/agents/") || url.pathname.startsWith("/skills/") ||
        url.pathname === "/health" || url.pathname === "/policies/check" ||
        url.pathname.startsWith("/memories") || url.pathname === "/search") {
      const origin = req.headers.origin;
      if (origin) {
        res.setHeader("access-control-allow-origin", origin);
        res.setHeader("vary", "Origin");
        res.setHeader("access-control-allow-headers", "content-type, authorization, x-api-key");
        res.setHeader("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
      }
      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    }

    // --- public endpoints (no auth) ---

    if (url.pathname === "/health" && req.method === "GET") {
      return json(res, 200, { status: "ok", version: "0.4.1", mode: "openapi" });
    }

    if (url.pathname === "/agents/manifest" && req.method === "GET") {
      return json(res, 200, agentsManifest);
    }

    if (url.pathname === "/skills/manifest" && req.method === "GET") {
      return json(res, 200, skillsManifest);
    }

    if (url.pathname === "/policies/check" && req.method === "POST") {
      const body = await readJsonBody(req);
      if (body.__invalid) return json(res, 400, { error: { code: "validation_error", message: "Invalid JSON body." } });
      const result = checkPolicy({
        action: body.action,
        target: body.target,
        context: body.context
      });
      return json(res, 200, { allowed: result.allowed, reason: result.reason, action: body.action });
    }

    // --- auth endpoints ---

    if (requireAuth) {
      const auth = authenticate(req);
      if (auth.error) return json(res, 401, { error: auth.error });

      // Resolve tenant
      const resolved = await userService.resolveApiKey(auth.apiKey);
      if (!resolved) return json(res, 401, { error: { code: "unauthorized", message: "Invalid API key." } });
      const tenantId = resolved.tenant_id;

      // Rate limit
      const rl = await enforceRateLimit(auth.apiKey, url.pathname, req.method);
      if (!rl.allowed) {
        if (rl.body?.error?.retry_after_seconds) {
          res.setHeader("retry-after", String(rl.body.error.retry_after_seconds));
        }
        return json(res, rl.status, rl.body);
      }

      // --- /search ---
      if (url.pathname === "/search" && req.method === "POST") {
        const body = await readJsonBody(req);
        if (body.__invalid) {
          if (rl.record) await rl.record("validation_error", "invalid_json");
          return json(res, 400, { error: { code: "validation_error", message: "Invalid JSON body." } });
        }
        const mode = body.mode === "semantic" || body.mode === "keyword" || body.mode === "hybrid"
          ? body.mode
          : "hybrid";
        if (typeof body.query !== "string" || body.query.length === 0) {
          if (rl.record) await rl.record("validation_error", "missing_query");
          return json(res, 400, { error: { code: "validation_error", message: "query is required." } });
        }
        try {
          const memoryService = await getMemoryService(tenantId);
          if (rl.record) await rl.record("success");
          // /search is implemented in v0.4.0 search-service.js, but we expose
          // a thin wrapper that always falls back to keyword if no
          // searchServiceFactory is provided (so this endpoint works even
          // before the search package is loaded).
          if (searchServiceFactory) {
            const ss = searchServiceFactory();
            const result = await ss.search({ tenantId, query: body.query, mode, limit: body.limit ?? 50 });
            return json(res, 200, { mode, results: result.results ?? result.items ?? [], provider_calls: 0 });
          }
          // Fallback: delegate to memoryService.listMemories filtered by q
          const list = await memoryService.listMemories(tenantId, { q: body.query, limit: body.limit ?? 50 });
          return json(res, 200, { mode: "keyword", results: list.items ?? [], provider_calls: 0 });
        } catch (err) {
          if (rl.record) await rl.record("internal_error", err.code);
          return json(res, 500, { error: { code: "internal_error", message: err.message } });
        }
      }

      // --- /memories ---
      if (url.pathname === "/memories" || url.pathname.startsWith("/memories/")) {
        try {
          const memoryService = await getMemoryService(tenantId);
          const segs = url.pathname.split("/").filter(Boolean);

          if (segs.length === 1 && req.method === "GET") {
            const opts = {};
            for (const k of ["limit", "offset", "type", "namespace", "tag", "q"]) {
              if (url.searchParams.has(k)) opts[k] = url.searchParams.get(k);
            }
            const list = await memoryService.listMemories(tenantId, opts);
            if (rl.record) await rl.record("success");
            return json(res, 200, list);
          }

          if (segs.length === 1 && req.method === "POST") {
            const body = await readJsonBody(req);
            if (body.__invalid) {
              if (rl.record) await rl.record("validation_error", "invalid_json");
              return json(res, 400, { error: { code: "validation_error", message: "Invalid JSON body." } });
            }
            const m = await memoryService.createMemory(tenantId, body);
            if (rl.record) await rl.record("success");
            return json(res, 201, m);
          }

          if (segs.length === 2 && req.method === "GET") {
            const m = await memoryService.getMemory(tenantId, segs[1]);
            if (!m) {
              if (rl.record) await rl.record("not_found");
              return json(res, 404, { error: { code: "not_found", message: "Memory not found." } });
            }
            if (rl.record) await rl.record("success");
            return json(res, 200, m);
          }

          if (segs.length === 2 && req.method === "PATCH") {
            const body = await readJsonBody(req);
            if (body.__invalid) {
              if (rl.record) await rl.record("validation_error", "invalid_json");
              return json(res, 400, { error: { code: "validation_error", message: "Invalid JSON body." } });
            }
            // namespace is immutable
            if ("namespace" in body) delete body.namespace;
            const m = await memoryService.updateMemory(tenantId, segs[1], body);
            if (!m) {
              if (rl.record) await rl.record("not_found");
              return json(res, 404, { error: { code: "not_found", message: "Memory not found." } });
            }
            if (rl.record) await rl.record("success");
            return json(res, 200, m);
          }

          if (segs.length === 2 && req.method === "DELETE") {
            const ok = await memoryService.deleteMemory(tenantId, segs[1]);
            if (!ok) {
              if (rl.record) await rl.record("not_found");
              return json(res, 404, { error: { code: "not_found", message: "Memory not found." } });
            }
            if (rl.record) await rl.record("success");
            return json(res, 200, { deleted: true, id: segs[1] });
          }

          if (rl.record) await rl.record("validation_error", "unknown_route");
          return json(res, 404, { error: { code: "not_found", message: "Route not found." } });
        } catch (err) {
          if (rl.record) await rl.record("internal_error", err.code);
          return json(res, err.status || 500, { error: { code: err.code || "internal_error", message: err.message } });
        }
      }
    }

    return json(res, 404, { error: { code: "not_found", message: "Route not found." } });
  };
}
