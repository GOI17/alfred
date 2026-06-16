import http from "node:http";
import { MemoryNotFoundError, MemoryValidationError, createMemoryService } from "./domain.js";
import { createInMemoryStore } from "./in-memory-store.js";

const JSON_CONTENT_TYPE = { "content-type": "application/json; charset=utf-8" };

function json(res, status, body) {
  res.writeHead(status, JSON_CONTENT_TYPE);
  res.end(`${JSON.stringify(body)}\n`);
}

function emptyJsonRequest(req) {
  return req.method === "GET" || req.method === "DELETE" || req.method === "HEAD";
}

async function readJsonBody(req) {
  if (emptyJsonRequest(req)) return {};
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new MemoryValidationError("Request body must be valid JSON.", [
      { field: "body", message: "Request body must be valid JSON." }
    ]);
  }
}

function errorBody(code, message, details) {
  return { error: removeUndefined({ code, message, details }) };
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function parseAuthHeader(req) {
  const apiKey = req.headers["x-api-key"];
  if (Array.isArray(apiKey)) return apiKey[0];
  if (typeof apiKey === "string" && apiKey.trim() !== "") return apiKey.trim();

  const authorization = req.headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }
  return undefined;
}

async function resolveUserId(apiKeys, apiKey) {
  if (!apiKey) return undefined;
  if (typeof apiKeys === "function") return apiKeys(apiKey);
  if (apiKeys instanceof Map) return apiKeys.get(apiKey);
  if (apiKeys && typeof apiKeys === "object") return apiKeys[apiKey];
  return undefined;
}

async function requireUserId(req, apiKeys) {
  const userId = await resolveUserId(apiKeys, parseAuthHeader(req));
  if (typeof userId !== "string" || userId.trim() === "") {
    const error = new Error("A valid API key is required.");
    error.status = 401;
    error.code = "unauthorized";
    throw error;
  }
  return userId;
}

function queryOptions(url) {
  return {
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    namespace: url.searchParams.get("namespace") ?? undefined,
    projectId: url.searchParams.get("projectId") ?? undefined,
    tag: url.searchParams.get("tag") ?? undefined
  };
}

function methodNotAllowed(res) {
  json(res, 405, errorBody("method_not_allowed", "Method is not allowed for this route."));
}

function routeMemoryId(pathname) {
  const match = pathname.match(/^\/memories\/([^/]+)$/);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch (error) {
    if (error instanceof URIError) {
      throw new MemoryValidationError("Memory id is invalid.", [
        { field: "id", message: "id must be valid percent-encoded UTF-8." }
      ]);
    }
    throw error;
  }
}

export function createMemoryHttpHandler({ service, apiKeys } = {}) {
  const memoryService = service ?? createMemoryService({ store: createInMemoryStore() });
  const keyResolver = apiKeys ?? {};

  return async function memoryHttpHandler(req, res) {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (url.pathname === "/health") {
        if (req.method !== "GET") return methodNotAllowed(res);
        return json(res, 200, { status: "ok" });
      }

      const userId = await requireUserId(req, keyResolver);

      if (url.pathname === "/memories") {
        if (req.method === "POST") {
          const body = await readJsonBody(req);
          const memory = await memoryService.createMemory(userId, body);
          return json(res, 201, memory);
        }
        if (req.method === "GET") {
          const result = await memoryService.listMemories(userId, queryOptions(url));
          return json(res, 200, result);
        }
        return methodNotAllowed(res);
      }

      if (url.pathname === "/memories/search") {
        if (req.method !== "GET") return methodNotAllowed(res);
        const result = await memoryService.searchMemories(userId, {
          ...queryOptions(url),
          q: url.searchParams.get("q") ?? undefined
        });
        return json(res, 200, result);
      }

      const id = routeMemoryId(url.pathname);
      if (id) {
        if (req.method === "GET") return json(res, 200, await memoryService.getMemory(userId, id));
        if (req.method === "PATCH") return json(res, 200, await memoryService.updateMemory(userId, id, await readJsonBody(req)));
        if (req.method === "DELETE") return json(res, 200, await memoryService.deleteMemory(userId, id));
        return methodNotAllowed(res);
      }

      return json(res, 404, errorBody("not_found", "Route was not found."));
    } catch (error) {
      return handleError(res, error);
    }
  };
}

function handleError(res, error) {
  if (error instanceof MemoryValidationError) {
    return json(res, 400, errorBody(error.code, error.message, error.details));
  }
  if (error instanceof MemoryNotFoundError) {
    return json(res, 404, errorBody(error.code, error.message));
  }
  if (error?.status === 401) {
    return json(res, 401, errorBody("unauthorized", "A valid API key is required."));
  }
  return json(res, 500, errorBody("internal_error", "Unexpected memory service error."));
}

export function createMemoryHttpServer(options = {}) {
  return http.createServer(createMemoryHttpHandler(options));
}
