// Gemini / Google AI Studio bridge HTTPS server.
//
// Google AI Studio Extensions require a HTTPS endpoint with an OpenAPI schema.
// This bridge is a thin forwarder: every request hits the upstream Alfred
// Memory Server with the configured API key. CORS is permissive for Google's
// domains by default but configurable.

import http from "node:http";
import https from "node:https";

const JSON_TYPE = { "content-type": "application/json; charset=utf-8" };

function json(res, status, body) {
  res.writeHead(status, JSON_TYPE);
  res.end(JSON.stringify(body) + "\n");
}

export function createBridge({
  baseUrl,
  apiKey,
  allowedOrigins = [
    "https://aistudio.google.com",
    "https://gemini.google.com",
    "https://generativelanguage.googleapis.com"
  ],
  fetchImpl = globalThis.fetch
} = {}) {
  if (!baseUrl) throw new TypeError("baseUrl is required");
  if (!apiKey) throw new TypeError("apiKey is required");
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }

  return async function bridge(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "OPTIONS") {
      const origin = req.headers.origin;
      if (origin && allowedOrigins.includes(origin)) {
        res.setHeader("access-control-allow-origin", origin);
        res.setHeader("vary", "Origin");
        res.setHeader("access-control-allow-headers", "content-type, x-api-key");
        res.setHeader("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
      }
      res.writeHead(204);
      res.end();
      return;
    }

    const target = `${baseUrl.replace(/\/$/, "")}${url.pathname}${url.search}`;
    const init = {
      method: req.method,
      headers: { "x-api-key": apiKey, accept: "application/json" }
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
