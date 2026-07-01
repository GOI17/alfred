// Web console router. Exposes /console/* and /console/api/* endpoints.
//
// The web console lives in a separate package (@alfred-labs/console-web).
// The memory-server does NOT depend on it at the package level. At runtime
// the operator wires them together via:
//
//   1. ALFRED_CONSOLE_DIR env var (e.g. ALFRED_CONSOLE_DIR=/opt/alfred/console/dist)
//   2. Auto-discovery: we look in well-known relative locations for a
//      sibling package's dist/, or system install paths.
//   3. If neither is found, the server returns 503 with instructions.
//
// For tests, pass consoleDirOverride directly to the constructor.
//
// Auth: every API endpoint requires an Authorization: Bearer alk_... header.

import { readFileSync, existsSync, statSync } from "node:fs";
import {
  createBootstrap,
  createSchemaProvisioner,
  createRateLimiter,
  createCaptchaVerifier,
  createEmailSender,
  createVerification,
  createRecovery,
  RecoveryRateLimitedError,
  RecoveryNotFoundError,
  RecoveryValidationError,
  BootstrapValidationError,
  BootstrapConfigError,
  BootstrapRateLimitedError
} from "./bootstrap/index.js";
import { dirname, resolve, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Well-known relative locations to look for the built console.
const SEARCH_PATHS = [
  // 1. Sibling package (npm workspace dev mode): from memory-server/src/ go up 3 to workspace,
  //    then into console-web/dist.
  join(here, "..", "..", "..", "console-web", "dist"),
  // 2. From scripts/ inside memory-server: ../packages/console-web/dist.
  join(here, "..", "..", "console-web", "dist"),
  // 3. From current working directory.
  join(process.cwd(), "console-web", "dist"),
  join(process.cwd(), "..", "console-web", "dist"),
  // 4. System install locations.
  "/usr/local/share/alfred/console/dist",
  "/opt/alfred/console/dist"
];

function findConsoleIndex() {
  // 1. Explicit env var.
  const envDir = process.env.ALFRED_CONSOLE_DIR;
  if (envDir) {
    const candidate = envDir.endsWith("index.html") ? envDir : join(envDir, "index.html");
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  // 2. Auto-discover.
  for (const p of SEARCH_PATHS) {
    const candidate = join(p, "index.html");
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function clientIpFromReq(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.length > 0) return real;
  return req.socket?.remoteAddress ?? "unknown";
}

// Lazy import: avoid forcing pg as a hard dependency for tests that don't use bootstrap.
let _pgModule = null;
async function loadPg() {
  if (_pgModule) return _pgModule;
  try { _pgModule = await import("pg"); return _pgModule; }
  catch { return null; }
}

async function pgClientFromUrl({ connectionString }) {
  const pg = await loadPg();
  if (!pg) throw new BootstrapConfigError("pg module not installed; ALFRED_SAAS_DATABASE_URL requires 'pg' in dependencies.");
  const client = new pg.Client({ connectionString });
  await client.connect();
  return client;
}

async function noopPgClient() {
  throw new BootstrapConfigError("Schema provisioner is not configured (no registry bound).");
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body) + "\n");
}

function html(res, status, body, contentType = "text/html; charset=utf-8") {
  res.writeHead(status, { "content-type": contentType });
  res.end(body);
}

function authenticate(req, userService) {
  const auth = req.headers.authorization;
  const apiKey = typeof auth === "string" && auth.startsWith("Bearer ")
    ? auth.slice("Bearer ".length).trim()
    : (typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : null);
  if (!apiKey) return { error: { code: "unauthorized", message: "API key required." } };
  return { apiKey };
}

async function readJsonBody(req) {
  if (req.method === "GET" || req.method === "DELETE") return {};
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") return {};
  try { return JSON.parse(raw); }
  catch { throw new Error("Invalid JSON body"); }
}

function notInstalledResponse(res, searchedPaths) {
  json(res, 503, {
    error: {
      code: "console_not_installed",
      message: "The web console is not installed alongside this server. " +
               "Either deploy the web console (recommended) at https://alfred.example.com/console and " +
               "set ALFRED_CONSOLE_URL in this server to that URL (cross-origin mode), " +
               "or run `npm run build` in @alfred-labs/console-web and set ALFRED_CONSOLE_DIR " +
               "to the resulting dist/ path. " +
               "Searched: " + searchedPaths.join(", ")
    }
  });
}

export function createConsoleRouter({
  userService,
  tenantService,
  config,
  consoleDirOverride = null,
  consoleUrl = null,
  registry = null,                          // v0.3.1: needed for bootstrap_attempts
  sharedUrl = process.env.ALFRED_SAAS_DATABASE_URL ?? null
} = {}) {
  if (!userService) throw new TypeError("userService required");
  if (!tenantService) throw new TypeError("tenantService required");

  // v0.3.1 SaaS Web Onboarding
  const rateLimiter = registry ? createRateLimiter({ registry }) : null;
  const schemaProvisioner = createSchemaProvisioner({ pgClient: sharedUrl ? pgClientFromUrl : noopPgClient });
  const captchaVerifier = createCaptchaVerifier();
  const emailSender = createEmailSender();
  const verification = registry ? createVerification({ registry, emailSender, baseUrl: process.env.ALFRED_PUBLIC_URL ?? "" }) : null;
  const recovery = registry ? createRecovery({ registry, userService, emailSender, baseUrl: process.env.ALFRED_PUBLIC_URL ?? "" }) : null;
  const bootstrap = registry
    ? createBootstrap({
        tenantService,
        userService,
        rateLimiter,
        schemaProvisioner,
        sharedUrl,
        captchaVerifier,
        verification
      })
    : null;

  // Resolve the index.html. Three modes, in priority order:
  // 1. consoleDirOverride (constructor arg) — explicit local path
  // 2. ALFRED_CONSOLE_DIR env var — operator-supplied build path
  // 3. Auto-discovery (well-known sibling / system install locations)
  // 4. 503 with instructions
  //
  // consoleDirOverride="" is a sentinel meaning "skip env var AND auto-discovery
  // and respond 503". This is used by tests to verify the 503 path.
  // consoleDirOverride=undefined (the default) means "use env var, then auto".
  let indexPath;
  // Normalize: null and undefined are the same "no override" signal.
  // "" is the force-503 sentinel. A non-empty string is the explicit path.
  if (consoleDirOverride === "" || consoleDirOverride === null || consoleDirOverride === undefined) {
    if (consoleDirOverride === "") {
      // Mode 4: sentinel for force 503. Skip env var and auto-discovery.
      indexPath = null;
    } else {
      // Mode 2 + 3: env var first, then auto-discover.
      indexPath = findConsoleIndex();
    }
  } else {
    // Mode 1: explicit local path
    indexPath = consoleDirOverride;
    if (!isAbsolute(indexPath) || indexPath.endsWith("dist")) {
      indexPath = indexPath.endsWith("index.html") ? indexPath : join(indexPath, "index.html");
    }
    if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
      throw new Error(`consoleDirOverride does not point to a valid index.html: ${indexPath}`);
    }
  }
  // indexPath may be null here → we will respond 503.

  // If consoleUrl is set (cross-origin deploy), the SPA lives elsewhere; the
  // server only serves the JSON API under /console/api/. The HTML index
  // returns a redirect to the upstream.
  const upstreamConsoleUrl = consoleUrl ?? process.env.ALFRED_CONSOLE_URL ?? null;

  return async function consoleHandler(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");

    // CORS for /console/api/*. Same-origin for inline-deploy; cross-origin
    // for upstream deploys (any origin allowed).
    if (url.pathname.startsWith("/console/api/")) {
      const origin = req.headers.origin;
      if (origin) {
        res.setHeader("access-control-allow-origin", origin);
        res.setHeader("vary", "Origin");
        res.setHeader("access-control-allow-headers", "content-type, authorization, x-api-key");
        res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
    }

    // Cross-origin upstream: redirect HTML index to the upstream URL.
    if (url.pathname === "/console" || url.pathname === "/console/") {
      if (upstreamConsoleUrl) {
        res.writeHead(302, { location: upstreamConsoleUrl });
        res.end();
        return;
      }
      // Inline mode: serve the bundled HTML.
      if (!indexPath) {
        return notInstalledResponse(res, SEARCH_PATHS);
      }
      try {
        const htmlText = readFileSync(indexPath, "utf8");
        return html(res, 200, htmlText);
      } catch (err) {
        return json(res, 500, { error: { code: "read_error", message: err.message } });
      }
    }

    // Static assets: /console/<path>
    if (url.pathname.startsWith("/console/") && !url.pathname.startsWith("/console/api/")) {
      if (upstreamConsoleUrl) {
        // Same as above — redirect.
        res.writeHead(302, { location: upstreamConsoleUrl + url.pathname.slice("/console".length) });
        res.end();
        return;
      }
      if (!indexPath) {
        return notInstalledResponse(res, SEARCH_PATHS);
      }
      // For MVP, return index.html for any unknown console path (SPA fallback).
      const htmlText = readFileSync(indexPath, "utf8");
      return html(res, 200, htmlText);
    }

    // v0.4.0 API: forgot-my-key recovery (POST request, GET consume)
    if (url.pathname === "/console/api/recover" && req.method === "POST") {
      if (!recovery) return json(res, 503, { error: { code: "recovery_not_configured", message: "Recovery is not configured on this server." } });
      let body = {};
      try { body = await readJsonBody(req); }
      catch (err) { return json(res, 400, { error: { code: "validation_error", message: err.message } }); }
      const ip = clientIpFromReq(req);
      try {
        const result = await recovery.requestRecovery({ ip, email: body.email });
        // Don't reveal whether the email exists: always 200 with a generic message.
        return json(res, 200, { ok: true, message: "If the email is registered, a recovery link has been sent." });
      } catch (err) {
        if (err instanceof RecoveryValidationError) {
          return json(res, 400, { error: { code: err.code, message: err.message, details: err.details } });
        }
        if (err instanceof RecoveryRateLimitedError) {
          return json(res, 429, { error: { code: err.code, message: err.message, retry_after_minutes: err.retryAfterMinutes } });
        }
        return json(res, 500, { error: { code: "internal_error", message: err.message } });
      }
    }

    if (url.pathname === "/console/api/recover" && req.method === "GET") {
      if (!recovery) return json(res, 503, { error: { code: "recovery_not_configured", message: "Recovery is not configured on this server." } });
      const token = url.searchParams.get("token");
      const result = await recovery.consumeRecovery({ token });
      if (!result) return json(res, 400, { error: { code: "invalid_token", message: "Recovery token is invalid." } });
      if (result.expired) return json(res, 410, { error: { code: "token_expired", message: "Recovery token has expired." } });
      return json(res, 200, {
        ok: true,
        tenant_id: result.tenant_id,
        email: result.email,
        api_key: result.api_key,
        key_prefix: result.key_prefix,
        key_id: result.key_id,
        old_key_id: result.old_key_id,
        consumed_at: result.consumed_at
      });
    }

    // v0.4.0 API: email verification (consume a magic link token)
    if (url.pathname === "/console/api/verify" && req.method === "GET") {
      if (!verification) {
        return json(res, 503, { error: { code: "verification_not_configured", message: "Email verification is not configured on this server." } });
      }
      const token = url.searchParams.get("token");
      const result = await verification.consumeVerification(token);
      if (!result) return json(res, 400, { error: { code: "invalid_token", message: "Verification token is invalid." } });
      if (result.expired) return json(res, 410, { error: { code: "token_expired", message: "Verification token has expired." } });
      return json(res, 200, { ok: true, tenant_id: result.tenant_id, email: result.email, verified_at: result.verified_at });
    }

    // v0.3.1 API: bootstrap (signup without auth)
    if (url.pathname === "/console/api/bootstrap" && req.method === "POST") {
      if (!bootstrap) {
        return json(res, 503, { error: { code: "saas_not_configured", message: "Bootstrap is not configured on this server." } });
      }
      let body = {};
      try { body = await readJsonBody(req); }
      catch (err) { return json(res, 400, { error: { code: "validation_error", message: err.message } }); }
      const ip = clientIpFromReq(req);
      // CAPTCHA token: prefer header, fall back to body field.
      const turnstileToken = (typeof req.headers["x-turnstile-token"] === "string" && req.headers["x-turnstile-token"])
        ? req.headers["x-turnstile-token"]
        : (typeof body.turnstile_token === "string" ? body.turnstile_token : null);
      try {
        const result = await bootstrap.createTenantAndFirstKey({
          ip,
          displayName: body.display_name,
          kind: body.kind,
          turnstileToken,
          email: typeof body.email === "string" ? body.email : null
        });
        // Record the successful attempt (best-effort; if rateLimiter is missing this is a no-op).
        try { await rateLimiter?.record({ ip, displayName: body.display_name, kind: body.kind, result: "success", tenantId: result.tenant.id }); } catch {}
        return json(res, 201, {
          ok: true,
          tenant: result.tenant,
          api_key: result.api_key,
          key_prefix: result.key_prefix,
          key_id: result.key_id,
          trace_event: "tenant.bootstrap"
        });
      } catch (err) {
        if (err instanceof BootstrapValidationError) {
          try { await rateLimiter?.record({ ip, displayName: body.display_name, kind: body.kind, result: "validation_error", errorCode: err.code }); } catch {}
          return json(res, 400, { error: { code: err.code, message: err.message, details: err.details } });
        }
        if (err instanceof BootstrapConfigError) {
          try { await rateLimiter?.record({ ip, displayName: body.display_name, kind: body.kind, result: "config_error", errorCode: err.code }); } catch {}
          return json(res, 503, { error: { code: err.code, message: err.message } });
        }
        if (err instanceof BootstrapRateLimitedError) {
          try { await rateLimiter?.record({ ip, displayName: body.display_name, kind: body.kind, result: "rate_limited", errorCode: err.code }); } catch {}
          return json(res, 429, { error: { code: err.code, message: err.message, retry_after_minutes: err.retryAfterMinutes } });
        }
        try { await rateLimiter?.record({ ip, displayName: body.display_name, kind: body.kind, result: "internal_error", errorCode: err.code || "internal_error" }); } catch {}
        return json(res, 500, { error: { code: "internal_error", message: err.message } });
      }
    }

    // API: list tenants
    if (url.pathname === "/console/api/tenants" && req.method === "GET") {
      try {
        const result = await tenantService.listTenants({ limit: 100, offset: 0 });
        return json(res, 200, result);
      } catch (err) {
        return json(res, 500, { error: { code: "internal_error", message: err.message } });
      }
    }

    // API: list keys for a tenant
    const listKeysMatch = url.pathname.match(/^\/console\/api\/tenants\/([^/]+)\/keys$/);
    if (listKeysMatch && req.method === "GET") {
      const auth = authenticate(req, userService);
      if (auth.error) return json(res, 401, { error: auth.error });
      const tenantId = decodeURIComponent(listKeysMatch[1]);
      const includeRevoked = url.searchParams.get("include_revoked") === "true";
      try {
        const keys = await userService.listApiKeys(tenantId, { includeRevoked });
        return json(res, 200, { ok: true, tenant_id: tenantId, keys });
      } catch (err) {
        return json(res, err.status || 500, { error: { code: err.code || "internal_error", message: err.message } });
      }
    }

    // API: issue new key for a tenant
    if (listKeysMatch && req.method === "POST") {
      const auth = authenticate(req, userService);
      if (auth.error) return json(res, 401, { error: auth.error });
      const tenantId = decodeURIComponent(listKeysMatch[1]);
      let body = {};
      try { body = await readJsonBody(req); }
      catch (err) { return json(res, 400, { error: { code: "validation_error", message: err.message } }); }
      try {
        const result = await userService.provisionApiKey({ tenant_id: tenantId, label: body.label || null });
        return json(res, 201, {
          ok: true,
          api_key: result.apiKey,
          key: result.key,
          tenant_id: tenantId
        });
      } catch (err) {
        return json(res, err.status || 500, { error: { code: err.code || "internal_error", message: err.message } });
      }
    }

    // API: revoke a key by id
    const revokeMatch = url.pathname.match(/^\/console\/api\/keys\/([^/]+)$/);
    if (revokeMatch && req.method === "DELETE") {
      const auth = authenticate(req, userService);
      if (auth.error) return json(res, 401, { error: auth.error });
      const keyId = decodeURIComponent(revokeMatch[1]);
      try {
        const result = await userService.revokeApiKey(keyId, { reason: "console revoke" });
        return json(res, 200, { ok: true, ...result });
      } catch (err) {
        return json(res, err.status || 500, { error: { code: err.code || "internal_error", message: err.message } });
      }
    }

    // 404
    return json(res, 404, { error: { code: "not_found", message: "Console route not found: " + url.pathname } });
  };
}
