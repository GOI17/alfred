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

test("OpenAPI JSON exists and is valid", () => {
  const spec = JSON.parse(readFileSync(openapiPath, "utf8"));
  assert.equal(spec.openapi, "3.1.0");
  assert.ok(spec.info.title);
  assert.ok(spec.info.version);
});

test("OpenAPI declares bearer auth", () => {
  const spec = JSON.parse(readFileSync(openapiPath, "utf8"));
  const sec = spec.components.securitySchemes.BearerAuth;
  assert.equal(sec.type, "http");
  assert.equal(sec.scheme, "bearer");
});

test("OpenAPI defines the five CRUD operations", () => {
  const spec = JSON.parse(readFileSync(openapiPath, "utf8"));
  const ops = ["listMemories", "createMemory", "searchMemories", "getMemory", "deleteMemory"];
  for (const op of ops) {
    let found = false;
    for (const path of Object.values(spec.paths)) {
      for (const method of ["get", "post", "delete", "patch", "put"]) {
        if (path[method]?.operationId === op) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
    assert.ok(found, `Operation ${op} must be declared in OpenAPI`);
  }
});

test("OpenAPI MemoryRecord schema requires id, type, content, source", () => {
  const spec = JSON.parse(readFileSync(openapiPath, "utf8"));
  const required = spec.components.schemas.MemoryRecord.required;
  for (const f of ["id", "type", "content", "source", "createdAt", "updatedAt"]) {
    assert.ok(required.includes(f), `MemoryRecord must require ${f}`);
  }
});

// ---------------------------------------------------------------------------
// Bridge tests (via fake req/res — sandbox blocks real listeners)
// ---------------------------------------------------------------------------

function fakeRes() {
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
  res._wait = new Promise((resolve) => {
    res._resolve = resolve;
    const orig = res.end.bind(res);
    res.end = function (...args) {
      orig(...args);
      resolve(res);
    };
  });
  return res;
}

test("bridge forwards GET /memories with Bearer header", async () => {
  let capturedPath = null;
  let capturedHeaders = null;
  const fetchImpl = async (url, init) => {
    capturedPath = url;
    capturedHeaders = init.headers;
    return new Response(JSON.stringify({ items: [], pagination: { limit: 50, offset: 0, total: 0 } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const bridge = createBridge({
    baseUrl: "https://alfred.example.com",
    apiKey: "alk_test",
    allowedOrigins: ["https://chat.openai.com"],
    fetchImpl
  });
  const res = fakeRes();
  await bridge({
    method: "GET",
    url: "/memories?limit=10",
    headers: { host: "x", origin: "https://chat.openai.com" }
  }, res);
  await res._wait;
  assert.match(capturedPath, /^https:\/\/alfred\.example\.com\/memories\?limit=10$/);
  assert.match(capturedHeaders.authorization, /^Bearer alk_test$/);
  assert.equal(res.statusCode, 200);
});

test("bridge forwards POST body bytes", async () => {
  let capturedBody = null;
  const fetchImpl = async (url, init) => {
    capturedBody = init.body;
    return new Response(JSON.stringify({ id: "m1", content: "" }), { status: 201, headers: { "content-type": "application/json" } });
  };
  const bridge = createBridge({ baseUrl: "https://x", apiKey: "alk_t", fetchImpl });
  const res = fakeRes();
  const body = JSON.stringify({ type: "fact", content: "Hello", source: "test" });
  const req = {
    method: "POST",
    url: "/memories",
    headers: { "content-type": "application/json", host: "x" },
    [Symbol.asyncIterator]() {
      const chunks = [Buffer.from(body)];
      let i = 0;
      return {
        next: () => i < chunks.length
          ? Promise.resolve({ value: chunks[i++], done: false })
          : Promise.resolve({ value: undefined, done: true })
      };
    }
  };
  await bridge(req, res);
  await res._wait;
  const parsed = JSON.parse(capturedBody.toString());
  assert.equal(parsed.content, "Hello");
});

test("bridge strips trailing slash from baseUrl", async () => {
  let capturedPath = null;
  const fetchImpl = async (url) => {
    capturedPath = url;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  const bridge = createBridge({ baseUrl: "https://x/", apiKey: "alk", fetchImpl });
  const res = fakeRes();
  await bridge({ method: "GET", url: "/health", headers: {} }, res);
  await res._wait;
  assert.equal(capturedPath, "https://x/health");
});

test("bridge responds 502 when upstream fetch throws", async () => {
  const fetchImpl = async () => { throw new Error("network down"); };
  const bridge = createBridge({ baseUrl: "https://x", apiKey: "alk", fetchImpl });
  const res = fakeRes();
  await bridge({ method: "GET", url: "/health", headers: {} }, res);
  await res._wait;
  assert.equal(res.statusCode, 502);
  assert.match(res.body, /network down/);
});

test("bridge CORS preflight echoes allowed origin", async () => {
  const bridge = createBridge({
    baseUrl: "https://x",
    apiKey: "alk",
    allowedOrigins: ["https://chat.openai.com"],
    fetchImpl: async () => new Response("{}", { status: 200 })
  });
  const res = fakeRes();
  await bridge({
    method: "OPTIONS",
    url: "/memories",
    headers: { origin: "https://chat.openai.com" }
  }, res);
  await res._wait;
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["access-control-allow-origin"], "https://chat.openai.com");
});

test("bridge CORS preflight blocks non-allowed origin", async () => {
  const bridge = createBridge({
    baseUrl: "https://x",
    apiKey: "alk",
    allowedOrigins: ["https://chat.openai.com"],
    fetchImpl: async () => new Response("{}", { status: 200 })
  });
  const res = fakeRes();
  await bridge({
    method: "OPTIONS",
    url: "/memories",
    headers: { origin: "https://evil.example.com" }
  }, res);
  await res._wait;
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["access-control-allow-origin"], undefined);
});

test("bridge requires baseUrl and apiKey", () => {
  assert.throws(() => createBridge({ apiKey: "x" }));
  assert.throws(() => createBridge({ baseUrl: "x" }));
  assert.throws(() => createBridge({ baseUrl: "x", apiKey: "y", fetchImpl: null }));
});
