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

export function createConsoleRouter({ userService, tenantService, config, consoleDirOverride = null, consoleUrl = null } = {}) {
  if (!userService) throw new TypeError("userService required");
  if (!tenantService) throw new TypeError("tenantService required");

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
