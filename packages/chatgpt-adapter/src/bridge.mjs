// Bridge HTTP server that maps Custom GPT Actions requests to Alfred Memory
// API calls. The bridge enforces the same auth (Bearer) and CORS allowlist.
//
// In production the bridge runs as a separate process that forwards calls
// from ChatGPT to the operator's self-hosted Alfred Memory Server. For local
// dev, both servers can run on the same host with different ports.

import http from "node:http";

const JSON_TYPE = { "content-type": "application/json; charset=utf-8" };

function json(res, status, body) {
  res.writeHead(status, JSON_TYPE);
  res.end(JSON.stringify(body) + "\n");
}

export function createBridge({
  baseUrl,
  apiKey,
  allowedOrigins = ["https://chat.openai.com"],
  fetchImpl = globalThis.fetch
} = {}) {
  if (!baseUrl) throw new TypeError("baseUrl is required");
  if (!apiKey) throw new TypeError("apiKey is required");
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }

  return async function bridgeHandler(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");

    // CORS preflight.
    if (req.method === "OPTIONS") {
      const origin = req.headers.origin;
      if (origin && allowedOrigins.includes(origin)) {
        res.setHeader("access-control-allow-origin", origin);
        res.setHeader("vary", "Origin");
        res.setHeader("access-control-allow-headers", "content-type, authorization");
        res.setHeader("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
      }
      res.writeHead(204);
      res.end();
      return;
    }

    // Forward everything else.
    const target = `${baseUrl.replace(/\/$/, "")}${url.pathname}${url.search}`;
    const init = {
      method: req.method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json"
      }
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      init.body = Buffer.concat(chunks);
      init.headers["content-type"] = req.headers["content-type"] || "application/json";
    }
    let upstream;
    try {
      upstream = await fetchImpl(target, init);
    } catch (err) {
      json(res, 502, { error: { code: "upstream_error", message: err.message } });
      return;
    }

    // Set CORS echo for actual response.
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "Origin");
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") || "application/json"
    });
    res.end(buf);
  };
}

export function createBridgeServer(opts) {
  return http.createServer(createBridge(opts));
}
