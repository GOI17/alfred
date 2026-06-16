export class MemoryApiError extends Error {
  constructor({ status, code, message, details }) {
    super(message);
    this.name = "MemoryApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function cleanBaseUrl(baseUrl) {
  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new TypeError("createMemoryClient requires a baseUrl.");
  }
  return baseUrl.replace(/\/+$/, "");
}

function addQuery(url, params = {}) {
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
}

async function parseResponse(response) {
  const text = await response.text();
  const body = text.trim() === "" ? undefined : JSON.parse(text);
  if (!response.ok) {
    const error = body?.error ?? {};
    throw new MemoryApiError({
      status: response.status,
      code: error.code ?? "http_error",
      message: error.message ?? `Memory API request failed with status ${response.status}.`,
      details: error.details
    });
  }
  return body;
}

export function createMemoryClient({ baseUrl, apiKey, fetch: fetchImplementation = globalThis.fetch } = {}) {
  const root = cleanBaseUrl(baseUrl);
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new TypeError("createMemoryClient requires an apiKey.");
  }
  if (typeof fetchImplementation !== "function") {
    throw new TypeError("createMemoryClient requires a fetch implementation.");
  }

  async function request(path, { method = "GET", query, body } = {}) {
    const url = new URL(`${root}${path}`);
    addQuery(url, query);
    const response = await fetchImplementation(url, {
      method,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return parseResponse(response);
  }

  return {
    createMemory(input) {
      return request("/memories", { method: "POST", body: input });
    },

    listMemories(options = {}) {
      return request("/memories", { query: options });
    },

    searchMemories(options = {}) {
      return request("/memories/search", { query: options });
    },

    getMemory(id) {
      return request(`/memories/${encodeURIComponent(id)}`);
    },

    updateMemory(id, patch) {
      return request(`/memories/${encodeURIComponent(id)}`, { method: "PATCH", body: patch });
    },

    deleteMemory(id) {
      return request(`/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
    }
  };
}
