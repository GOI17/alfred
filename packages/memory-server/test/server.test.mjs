import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createTenantService,
  createInMemoryTenantStore,
  createUserService,
  createInMemoryUserStore,
  createMemoryService,
  createInMemoryStore
} from "../../memory/src/index.js";
import {
  loadServerConfig,
  createApp
} from "../src/server.js";

function makeWireServices() {
  const tenantStore = createInMemoryTenantStore();
  const tenantService = createTenantService({ store: tenantStore });
  const memoryStore = createInMemoryStore();
  const memoryService = createMemoryService({ store: memoryStore });
  const userStore = createInMemoryUserStore({ initialTenants: [] });
  const userService = createUserService({ store: userStore });
  // Factory: returns the same in-memory service for any tenant. In production
  // this opens a per-tenant SQLite file. For unit-test purposes we don't care.
  const getMemoryService = async () => memoryService;
  return { tenantService, memoryService, userService, userStore, getMemoryService };
}

async function setupTenantAndKey({ tenantService, userService, userStore }) {
  const tenant = await tenantService.provisionTenant({
    kind: "coding_agent_only",
    storage_backend: "sqlite",
    db_path: "/tmp/x.sqlite"
  });
  await userStore.addTenantStub({
    id: tenant.id,
    kind: tenant.kind,
    storage_backend: tenant.storage_backend,
    db_path: tenant.db_path
  });
  const { apiKey } = await userService.provisionApiKey({ tenant_id: tenant.id });
  return { tenant, apiKey };
}

// Direct invocation — no listen. We construct a fake req/res and call the
// handler returned by createApp().
function fakeReq({ method = "GET", url = "/", headers = {}, body = undefined } = {}) {
  const r = {
    method,
    url,
    headers,
    [Symbol.asyncIterator]() {
      const chunks = body !== undefined ? [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))] : [];
      let i = 0;
      return {
        next() {
          if (i < chunks.length) return Promise.resolve({ value: chunks[i++], done: false });
          return Promise.resolve({ value: undefined, done: true });
        },
        return() {
          return Promise.resolve({ value: undefined, done: true });
        }
      };
    }
  };
  return r;
}

function captureRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    chunks: [],
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      for (const [k, v] of Object.entries(headers || {})) this.setHeader(k, v);
    },
    write(chunk) {
      this.chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    },
    end(chunk) {
      if (chunk !== undefined) this.write(chunk);
      this.body = this.chunks.join("");
      this.ended = true;
      this._resolve && this._resolve();
    },
    once(name, cb) {
      // No-op: the server never fires 'finish' in our synchronous path.
    },
    on() {},
    finished: false,
    ended: false
  };
  return res;
}

async function invoke(handler, req) {
  const res = captureRes();
  let done;
  res._resolve = null;
  done = new Promise((resolve) => {
    res._resolve = resolve;
  });
  await handler(req, res);
  await done;
  return res;
}

test("loadServerConfig defaults to local mode and bind 127.0.0.1", () => {
  const cfg = loadServerConfig({ ALFRED_MEMORY_HOSTING: undefined });
  assert.equal(cfg.mode, "local");
  assert.equal(cfg.bind, "127.0.0.1");
  assert.equal(cfg.requireAuth, false);
});

test("loadServerConfig rejects unknown mode", () => {
  assert.throws(
    () => loadServerConfig({ ALFRED_MEMORY_HOSTING: "federated" }),
    (err) => err.name === "ServerConfigError"
  );
});

test("loadServerConfig self-hosted requires TLS cert and key", () => {
  assert.throws(
    () => loadServerConfig({ ALFRED_MEMORY_HOSTING: "self-hosted" }),
    (err) => err.name === "ServerConfigError"
  );
});

test("/health responds 200 with mode", async () => {
  const services = makeWireServices();
  const app = createApp({
    ...services,
    getMemoryService: services.getMemoryService,
    config: { mode: "local", requireAuth: false, allowedOrigins: [], port: 0, bind: "127.0.0.1" }
  });
  const res = await invoke(app, fakeReq({ method: "GET", url: "/health" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.status, "ok");
});

test("/policy responds 200 with validatePolicy report", async () => {
  const services = makeWireServices();
  const app = createApp({
    ...services,
    getMemoryService: services.getMemoryService,
    config: { mode: "local", requireAuth: false, allowedOrigins: [], port: 0, bind: "127.0.0.1" }
  });
  const res = await invoke(app, fakeReq({ method: "GET", url: "/policy" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
});

test("/memories requires API key when mode is self-hosted", async () => {
  const services = makeWireServices();
  const app = createApp({
    ...services,
    getMemoryService: services.getMemoryService,
    config: { mode: "self-hosted", requireAuth: true, allowedOrigins: [], port: 0, bind: "127.0.0.1" }
  });
  const res = await invoke(app, fakeReq({ method: "GET", url: "/memories" }));
  assert.equal(res.statusCode, 401);
});

test("/memories accepts a valid API key and CRUD lifecycle", async () => {
  const services = makeWireServices();
  const { apiKey } = await setupTenantAndKey(services);
  const app = createApp({
    ...services,
    getMemoryService: services.getMemoryService,
    config: { mode: "self-hosted", requireAuth: true, allowedOrigins: [], port: 0, bind: "127.0.0.1" }
  });

  const create = await invoke(app, fakeReq({
    method: "POST",
    url: "/memories",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: { type: "preference", content: "Hello", tags: ["t"], source: "test" }
  }));
  assert.equal(create.statusCode, 201);
  const memory = JSON.parse(create.body);
  assert.ok(memory.id);

  const list = await invoke(app, fakeReq({
    method: "GET",
    url: "/memories",
    headers: { authorization: `Bearer ${apiKey}` }
  }));
  assert.equal(list.statusCode, 200);
  const listBody = JSON.parse(list.body);
  assert.equal(listBody.items.length, 1);

  const search = await invoke(app, fakeReq({
    method: "GET",
    url: "/memories/search?q=Hello",
    headers: { authorization: `Bearer ${apiKey}` }
  }));
  assert.equal(search.statusCode, 200);
  const searchBody = JSON.parse(search.body);
  assert.ok(searchBody.items.length >= 1);

  const del = await invoke(app, fakeReq({
    method: "DELETE",
    url: `/memories/${memory.id}`,
    headers: { authorization: `Bearer ${apiKey}` }
  }));
  assert.equal(del.statusCode, 200);
});

test("/memories rejects a tampered API key with 401", async () => {
  const services = makeWireServices();
  const { apiKey } = await setupTenantAndKey(services);
  const app = createApp({
    ...services,
    getMemoryService: services.getMemoryService,
    config: { mode: "self-hosted", requireAuth: true, allowedOrigins: [], port: 0, bind: "127.0.0.1" }
  });
  const res = await invoke(app, fakeReq({
    method: "GET",
    url: "/memories",
    headers: { authorization: `Bearer ${apiKey.slice(0, -2)}xx` }
  }));
  assert.equal(res.statusCode, 401);
});

test("OPTIONS preflight in self-hosted with allowed origin echoes that origin", async () => {
  const services = makeWireServices();
  const app = createApp({
    ...services,
    getMemoryService: services.getMemoryService,
    config: {
            mode: "self-hosted",
      requireAuth: true,
      allowedOrigins: ["https://chat.openai.com"],
      port: 0,
      bind: "127.0.0.1"
    }
  });
  const res = await invoke(app, fakeReq({
    method: "OPTIONS",
    url: "/memories",
    headers: {
      origin: "https://chat.openai.com",
      "access-control-request-method": "POST"
    }
  }));
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["access-control-allow-origin"], "https://chat.openai.com");
});

test("OPTIONS preflight without allowed origin does not set CORS header", async () => {
  const services = makeWireServices();
  const app = createApp({
    ...services,
    getMemoryService: services.getMemoryService,
    config: {
            mode: "self-hosted",
      requireAuth: true,
      allowedOrigins: ["https://chat.openai.com"],
      port: 0,
      bind: "127.0.0.1"
    }
  });
  const res = await invoke(app, fakeReq({
    method: "OPTIONS",
    url: "/memories",
    headers: {
      origin: "https://evil.example.com",
      "access-control-request-method": "POST"
    }
  }));
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["access-control-allow-origin"], undefined);
});

test("Local mode accepts loopback-anonymous without API key", async () => {
  const services = makeWireServices();
  const app = createApp({
    ...services,
    getMemoryService: services.getMemoryService,
    config: { mode: "local", requireAuth: false, allowedOrigins: [], port: 0, bind: "127.0.0.1" }
  });
  const res = await invoke(app, fakeReq({ method: "GET", url: "/memories?limit=5" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(Array.isArray(body.items));
});
