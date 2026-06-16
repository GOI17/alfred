export { MemoryClientError } from "./errors.js";

import { MemoryClientError } from "./errors.js";

const JSON_CONTENT_TYPE = "application/json";

export function createMemoryClient(options = {}) {
  const config = normalizeOptions(options);

  return {
    createMemory(input) {
      assertPlainObject(input, "input", "createMemory input is required.");
      return request(config, "/memories", {
        method: "POST",
        body: input
      });
    },

    getMemory(id) {
      const memoryId = normalizeRequiredString(id, "id");
      return request(config, `/memories/${encodeURIComponent(memoryId)}`);
    },

    listMemories(options = {}) {
      assertPlainObject(options, "options", "listMemories options must be an object.", "validation_error");
      return request(config, `/memories${queryString(options)}`);
    },

    searchMemories(options = {}) {
      assertPlainObject(options, "options", "searchMemories options must be an object.", "validation_error");
      normalizeRequiredString(options.q, "q");
      return request(config, `/memories/search${queryString(options)}`);
    },

    updateMemory(id, patch) {
      const memoryId = normalizeRequiredString(id, "id");
      assertPlainObject(patch, "patch", "updateMemory patch is required.");
      return request(config, `/memories/${encodeURIComponent(memoryId)}`, {
        method: "PATCH",
        body: patch
      });
    },

    deleteMemory(id) {
      const memoryId = normalizeRequiredString(id, "id");
      return request(config, `/memories/${encodeURIComponent(memoryId)}`, {
        method: "DELETE"
      });
    }
  };
}

function normalizeOptions(options) {
  assertPlainObject(options, "options", "Memory client options are required.", "configuration_error");

  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const apiKey = normalizeRequiredString(options.apiKey, "apiKey", "configuration_error");
  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new MemoryClientError("A fetch implementation is required.", {
      code: "configuration_error",
      details: [{ field: "fetch", message: "fetch must be a function." }]
    });
  }

  return { baseUrl, apiKey, fetch: fetchImpl };
}

function normalizeBaseUrl(baseUrl) {
  const value = normalizeRequiredString(baseUrl, "baseUrl", "configuration_error");
  try {
    new URL(value);
  } catch (cause) {
    throw new MemoryClientError("baseUrl must be a valid URL.", {
      code: "configuration_error",
      details: [{ field: "baseUrl", message: "baseUrl must be a valid URL." }],
      cause
    });
  }
  return value.replace(/\/+$/, "");
}

async function request(config, path, { method = "GET", body } = {}) {
  const headers = { "x-api-key": config.apiKey };
  const init = { method, headers };

  if (body !== undefined) {
    headers["content-type"] = JSON_CONTENT_TYPE;
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await config.fetch(`${config.baseUrl}${path}`, init);
  } catch (cause) {
    throw new MemoryClientError("Memory API request failed.", {
      code: "network_error",
      cause
    });
  }

  const payload = await parseResponseBody(response);

  if (!response.ok) {
    throw errorFromResponse(response, payload);
  }

  return payload;
}

async function parseResponseBody(response) {
  const contentType = response.headers?.get?.("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return undefined;

  try {
    return await response.json();
  } catch (cause) {
    throw new MemoryClientError("Memory API returned invalid JSON.", {
      code: "http_error",
      status: response.status,
      cause
    });
  }
}

function errorFromResponse(response, payload) {
  if (payload?.error && typeof payload.error === "object") {
    return new MemoryClientError(payload.error.message ?? "Memory API request failed.", {
      code: payload.error.code ?? "http_error",
      status: response.status,
      details: payload.error.details
    });
  }

  return new MemoryClientError("Memory API request failed.", {
    code: "http_error",
    status: response.status
  });
}

function queryString(options) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry !== undefined && entry !== null && entry !== "") params.append(key, String(entry));
      }
      continue;
    }
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

function normalizeRequiredString(value, field, code = "validation_error") {
  if (typeof value !== "string" || value.trim() === "") {
    throw new MemoryClientError(`${field} is required.`, {
      code,
      details: [{ field, message: `${field} must be a non-empty string.` }]
    });
  }
  return value.trim();
}

function assertPlainObject(value, field, message, code = "validation_error") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MemoryClientError(message, {
      code,
      details: [{ field, message }]
    });
  }
}
