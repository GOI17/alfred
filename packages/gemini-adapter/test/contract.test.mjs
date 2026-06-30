import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createBridge } from "../src/bridge.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const openapiPath = resolve(here, "..", "openapi.json");

// ---------------------------------------------------------------------------
// OpenAPI contract tests
// ---------------------------------------------------------------------------

test("OpenAPI JSON exists and is valid 3.0.3", () => {
  const spec = JSON.parse(readFileSync(openapiPath, "utf8"));
  assert.equal(spec.openapi, "3.0.3");
  assert.ok(spec.info.title);
  assert.ok(spec.info.version);
});

test("OpenAPI declares API key security scheme in header", () => {
  const spec = JSON.parse(readFileSync(openapiPath, "utf8"));
  const sec = spec.components.securitySchemes.ApiKeyAuth;
  assert.equal(sec.type, "apiKey");
  assert.equal(sec.in, "header");
  assert.equal(sec.name, "x-api-key");
});

test("OpenAPI defines the five CRUD operations", () => {
  const spec = JSON.parse(readFileSync(openapiPath, "utf8"));
  const ops = [
    "alfred_list_memories",
    "alfred_create_memory",
    "alfred_search_memories",
    "alfred_get_memory",
    "alfred_delete_memory"
  ];
  for (const op of ops) {
    let found = false;
    for (const path of Object.values(spec.paths)) {
      for (const method of ["get","post","delete","patch","put"]) {
        if (path[method]?.operationId === op) { found = true; break; }
      }
      if (found) break;
    }
    assert.ok(found, `Operation ${op} must be declared`);
  }
});

// ---------------------------------------------------------------------------
// Bridge tests using fake upstream
// ---------------------------------------------------------------------------

test("bridge forwards GET /memories with x-api-key header", async () => {
  let capturedHeaders = null;
  const fetchImpl = async (_url, init) => {
    capturedHeaders = init.headers;
    return new Response(JSON.stringify({ items: [], pagination: { total: 0 } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const bridge = createBridge({
    baseUrl: "https://alfred.example.com",
    apiKey: "alk_test_xyz",
    fetchImpl
  });
  const res = await invoke(bridge, {
    method: "GET",
    url: "/memories?limit=5",
    headers: { host: "x" }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(capturedHeaders["x-api-key"], "alk_test_xyz");
});

test("bridge forwards POST body bytes", async () => {
  let capturedBody = null;
  const fetchImpl = async (_url, init) => {
    capturedBody = init.body;
    return new Response("{}", { status: 201, headers: { "content-type": "application/json" } });
  };
  const bridge = createBridge({
    baseUrl: "https://x",
    apiKey: "alk_t",
    fetchImpl
  });
  const body = JSON.stringify({ type: "fact", content: "hi", source: "gemini" });
  const res = await invoke(bridge, {
    method: "POST",
    url: "/memories",
    headers: { "content-type": "application/json", host: "x" },
    body
  });
  assert.equal(res.statusCode, 201);
  assert.equal(JSON.parse(capturedBody.toString()).content, "hi");
});

test("bridge responds 502 when upstream fetch throws", async () => {
  const fetchImpl = async () => { throw new Error("network down"); };
  const bridge = createBridge({
    baseUrl: "https://x",
    apiKey: "alk",
    fetchImpl
  });
  const res = await invoke(bridge, { method: "GET", url: "/health", headers: {} });
  assert.equal(res.statusCode, 502);
  assert.match(res.body, /network down/);
});

test("bridge strips trailing slash from baseUrl", async () => {
  let capturedUrl = null;
  const fetchImpl = async (url) => {
    capturedUrl = url;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  const bridge = createBridge({ baseUrl: "https://x/", apiKey: "alk", fetchImpl });
  const res = await invoke(bridge, { method: "GET", url: "/health", headers: {} });
  assert.equal(capturedUrl, "https://x/health");
});

test("bridge CORS preflight allows Google AI Studio origin", async () => {
  const bridge = createBridge({
    baseUrl: "https://x",
    apiKey: "alk",
    fetchImpl: async () => new Response("{}", { status: 200 })
  });
  const res = await invoke(bridge, {
    method: "OPTIONS",
    url: "/memories",
    headers: { origin: "https://aistudio.google.com" }
  });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["access-control-allow-origin"], "https://aistudio.google.com");
});

test("bridge CORS preflight blocks arbitrary origin", async () => {
  const bridge = createBridge({
    baseUrl: "https://x",
    apiKey: "alk",
    fetchImpl: async () => new Response("{}", { status: 200 })
  });
  const res = await invoke(bridge, {
    method: "OPTIONS",
    url: "/memories",
    headers: { origin: "https://evil.example.com" }
  });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["access-control-allow-origin"], undefined);
});

test("bridge requires baseUrl and apiKey", () => {
  assert.throws(() => createBridge({ apiKey: "x" }));
  assert.throws(() => createBridge({ baseUrl: "x" }));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function invoke(handler, req) {
  const res = {
    statusCode: 200,
    headers: {},
    body: "",
    chunks: [],
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    writeHead(status, headers) {
      this.statusCode = status;
      for (const [k, v] of Object.entries(headers || {})) this.setHeader(k, v);
    },
    write(chunk) { this.chunks.push(typeof chunk === "string" ? chunk : chunk.toString()); },
    end(chunk) {
      if (chunk !== undefined) this.write(chunk);
      this.body = this.chunks.join("");
    },
    once() {}, on() {}
  };
  if (req.body !== undefined) {
    const buf = Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body));
    req[Symbol.asyncIterator] = () => {
      let i = 0;
      const chunks = [buf];
      return {
        next: () => i < chunks.length
          ? Promise.resolve({ value: chunks[i++], done: false })
          : Promise.resolve({ value: undefined, done: true })
      };
    };
  } else {
    req[Symbol.asyncIterator] = () => ({
      next: () => Promise.resolve({ value: undefined, done: true })
    });
  }
  return Promise.resolve(handler(req, res)).then(() => res);
}
