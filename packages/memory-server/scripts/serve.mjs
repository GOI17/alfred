#!/usr/bin/env node
// alfred serve: start the Alfred Memory Server.
// Honors ALFRED_MEMORY_HOSTING (local|self-hosted) and binds accordingly.
// Tenant data lives in the SQLite-backed registry (canonical) at
// ALFRED_MEMORY_REGISTRY. Per-tenant memories are stored at the path
// recorded in the registry (db_path or db_connection).
import {
  loadServerConfig,
  createApp,
  createServer,
  startServer
} from "../src/server.js";
import { createConsoleRouter } from "../src/index.js";
import {
  createTenantService,
  createUserService,
  createMemoryService,
  createInMemoryStore
} from "../../memory/src/index.js";
import { openRegistry, defaultRegistryPath } from "../src/registry/store-factory.js";
import { createSqliteMemoryStore, openSqliteMemoryStore } from "../../memory/src/sqlite-memory-store.js";
import { readFileSync } from "node:fs";

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) { out[k] = true; } else { out[k] = v; i += 1; }
    } else { out._.push(a); }
  }
  return out;
}

function notImpl(op) {
  return () => {
    const e = new Error(`postgres memory store not implemented in MVP; the registry entry must use storage_backend=sqlite for the bundled server. Use external Postgres via a deploy-time swap. (op=${op})`);
    e.code = "not_implemented";
    throw e;
  };
}

function createTenantMemoryStoreFactory(registry) {
  // Returns a function that maps a tenant id to its MemoryService.
  // For sqlite tenants, open the per-tenant DB on demand. For postgres,
  // throws (out of MVP scope).
  const cache = new Map();
  return async function memoryServiceFor(tenantId) {
    if (cache.has(tenantId)) return cache.get(tenantId);
    const tenant = await registry.tenants.getTenant(tenantId);
    if (!tenant) throw new Error("Tenant not found: " + tenantId);
    if (tenant.storage_backend !== "sqlite") {
      throw new Error("Tenant uses storage_backend=" + tenant.storage_backend + "; only sqlite is bundled in MVP. Use an external Postgres proxy.");
    }
    if (!tenant.db_path) throw new Error("Tenant has no db_path.");
    const store = openSqliteMemoryStore(tenant.db_path);
    const service = createMemoryService({ store });
    cache.set(tenantId, service);
    return service;
  };
}

export async function run(argv = [], env = process.env) {
  const args = parseArgs(argv);
  const merged = { ...env, ...args };
  let config;
  try {
    config = loadServerConfig(merged);
  } catch (err) {
    process.stderr.write(`Server config error: ${err.message}\n`);
    return 2;
  }

  const registry = await openRegistry();
  const tenantService = createTenantService({ store: registry.tenants });
  const userService = createUserService({ store: registry.users });
  const memoryFactory = createTenantMemoryStoreFactory(registry);
  // The web console may be deployed elsewhere (Vercel, Netlify, GH Pages) or
  // alongside the server. Three resolution modes:
  //   1. ALFRED_CONSOLE_URL set → cross-origin upstream (e.g. https://console.alfred.example.com)
  //   2. ALFRED_CONSOLE_DIR set → operator-built dist/ path
  //   3. neither set → router auto-discovers or returns 503 with instructions
  const consoleOpts = {};
  if (env.ALFRED_CONSOLE_URL) consoleOpts.consoleUrl = env.ALFRED_CONSOLE_URL;
  if (env.ALFRED_CONSOLE_DIR) consoleOpts.consoleDirOverride = env.ALFRED_CONSOLE_DIR;
  const consoleRouter = createConsoleRouter({ userService, tenantService, config, ...consoleOpts });
  const app = createApp({
    tenantService,
    memoryService: null,  // unused; we route per-tenant
    userService,
    config,
    getMemoryService: memoryFactory
  });

  const server = createServer({ app });
  await new Promise((resolve, reject) => {
    if (config.mode === "self-hosted") {
      try {
        const tls = { cert: readFileSync(config.tlsCert), key: readFileSync(config.tlsKey) };
        // Replace with new https server reading our handler.
        server.close();
      } catch (e) { /* ignore */ }
    }
    server.listen(config.port, config.bind, () => resolve());
    server.on("error", reject);
  });
  process.stderr.write(`alfred-memory listening on ${config.bind}:${config.port} (${config.mode})\n`);
  process.stderr.write(`registry: ${registry.dbPath}\n`);
  process.on("SIGINT", () => {
    process.stderr.write("\nshutting down\n");
    server.close(() => {
      try { registry.close(); } catch {}
      process.exit(0);
    });
  });
  // Block forever.
  await new Promise(() => {});
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Disable if we are not running this as the entrypoint.
  if (!process.env.ALFRED_SERVE_RUN) {
    process.stderr.write("serve.mjs: refusing to run directly. Use `alfred serve` via scripts/alfred.mjs.\n");
    process.exit(0);
  }
  process.exit(await run(process.argv.slice(2)));
}
