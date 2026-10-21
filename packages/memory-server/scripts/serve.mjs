#!/usr/bin/env node
// alfred serve: start the Alfred Memory Server.
// Runs only on loopback; validates configuration before opening any registry.
// Tenant data lives in the SQLite-backed registry (canonical) at
// ALFRED_MEMORY_REGISTRY. Per-tenant memories are stored at the path
// recorded in the registry (db_path or db_connection).
import {
  loadServerConfig,
  createApp,
  startServer
} from "../src/server.js";
import {
  createConsoleRouter,
  createOpenapiRouter,
  createOAuthRouter,
  createMcpRouter,
  createOAuthService,
  loadOAuthConfig
} from "../src/index.js";
import {
  createTenantService,
  createUserService,
  createMemoryService,
  createPostgresMemoryStore
} from "../../memory/src/index.js";
import { openRegistry } from "../src/registry/store-factory.js";
import { openSqliteMemoryStore } from "../../memory/src/sqlite-memory-store.js";
import { createAgentActivity } from "../src/agent-activity.js";

const POSTGRES_SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/;

function parsePostgresUrl(connectionString) {
  if (typeof connectionString !== "string") {
    throw new TypeError("PostgreSQL connection string must be a string.");
  }
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new TypeError("PostgreSQL connection string must be a valid URL.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new TypeError("PostgreSQL connection string must use postgres:// or postgresql://.");
  }
  return url;
}

function assertPostgresSchema(schema) {
  if (typeof schema !== "string" || !POSTGRES_SCHEMA_RE.test(schema)) {
    throw new TypeError("PostgreSQL tenant schema must be a safe lowercase identifier.");
  }
  return schema;
}

function legacySearchPathSchema(connectionString) {
  const options = parsePostgresUrl(connectionString).searchParams.get("options");
  if (!options) return null;
  const match = options.match(/(?:^|\s)-c\s*search_path=([a-z_][a-z0-9_]{0,62})(?:,public)?(?:\s|$)/);
  return match?.[1] ?? null;
}

export function withoutStartupOptions(connectionString) {
  const url = parsePostgresUrl(connectionString);
  url.searchParams.delete("options");
  return url.toString();
}

export function tenantPostgresSchema(tenant) {
  if (!tenant || typeof tenant !== "object") {
    throw new TypeError("PostgreSQL tenant must be an object.");
  }
  const metadataSchema = tenant.metadata?.schema;
  if (metadataSchema !== undefined && metadataSchema !== null) {
    return assertPostgresSchema(metadataSchema);
  }

  if (tenant.db_connection) {
    const legacySchema = legacySearchPathSchema(tenant.db_connection);
    if (legacySchema) return assertPostgresSchema(legacySchema);
  }

  if (typeof tenant.id === "string" && /^usr_t_[a-f0-9]{32}$/.test(tenant.id)) {
    return `tenant_${tenant.id.slice("usr_t_".length)}`;
  }

  // Manually configured, non-SaaS Postgres tenants historically used public.
  return "public";
}

export function loadServeConfig(argv = [], env = process.env) {
  const merged = { ...env };
  const names = { port: "ALFRED_MEMORY_PORT", bind: "ALFRED_MEMORY_BIND", hosting: "ALFRED_MEMORY_HOSTING" };
  for (let i = 0; i < argv.length; i += 1) {
    const match = /^--(port|bind|hosting)(?:=(.*))?$/.exec(argv[i]);
    if (!match) throw new Error(`Unknown serve option: ${argv[i]}`);
    const value = match[2] ?? argv[++i];
    if (typeof value !== "string" || value === "" || value.startsWith("--")) {
      throw new Error(`--${match[1]} requires a value.`);
    }
    merged[names[match[1]]] = value;
  }
  return { config: loadServerConfig(merged), env: merged };
}

async function defaultPostgresPoolFactory({ connectionString }) {
  const pg = await import("pg");
  const Pool = pg.Pool ?? pg.default?.Pool;
  if (typeof Pool !== "function") {
    throw new Error("The pg package does not expose Pool.");
  }
  return new Pool({
    connectionString,
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
  });
}

export function createTenantMemoryStoreFactory(registry, {
  postgresPoolFactory = defaultPostgresPoolFactory
} = {}) {
  if (!registry?.tenants || typeof registry.tenants.getTenant !== "function") {
    throw new TypeError("createTenantMemoryStoreFactory requires a registry tenant store.");
  }
  if (typeof postgresPoolFactory !== "function") {
    throw new TypeError("postgresPoolFactory must be a function.");
  }

  // Cache the initialization promise so concurrent first requests for one
  // tenant cannot open duplicate pools. Queries explicitly qualify the tenant
  // schema and never depend on pooled connection session state.
  const cache = new Map();
  const closeables = new Set();

  async function buildMemoryService(tenantId) {
    const tenant = await registry.tenants.getTenant(tenantId);
    if (!tenant) throw new Error("Tenant not found: " + tenantId);

    if (tenant.storage_backend === "sqlite") {
      if (!tenant.db_path) throw new Error("Tenant has no db_path.");
      return createMemoryService({ store: openSqliteMemoryStore(tenant.db_path), trace: (event) => registry.oauth?.recordTrace({ ...event, tenant_id: tenantId }) });
    }

    if (tenant.storage_backend === "postgres") {
      if (!tenant.db_connection) throw new Error("PostgreSQL tenant has no db_connection.");
      const schema = tenantPostgresSchema(tenant);
      const pool = await postgresPoolFactory({
        connectionString: withoutStartupOptions(tenant.db_connection),
        tenantId: tenant.id
      });
      if (!pool || typeof pool.query !== "function") {
        throw new TypeError("postgresPoolFactory must return a pg-style pool.");
      }
      try {
        // This is idempotent and also repairs tenants created before the
        // provisioner started seeding alfred_memory_users.
        await pool.query(
          `INSERT INTO "${schema}"."alfred_memory_users" (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
          [tenant.id]
        );
      } catch (err) {
        if (typeof pool.end === "function") await pool.end().catch(() => undefined);
        throw err;
      }
      if (typeof pool.end === "function") closeables.add(pool);
      return createMemoryService({ store: createPostgresMemoryStore(pool, { schema }), trace: (event) => registry.oauth?.recordTrace({ ...event, tenant_id: tenantId }) });
    }

    throw new Error("Unsupported tenant storage_backend=" + tenant.storage_backend);
  }

  async function memoryServiceFor(tenantId) {
    if (cache.has(tenantId)) return cache.get(tenantId);
    const pending = buildMemoryService(tenantId).catch((err) => {
      cache.delete(tenantId);
      throw err;
    });
    cache.set(tenantId, pending);
    return pending;
  }

  memoryServiceFor.close = async () => {
    cache.clear();
    const pools = [...closeables];
    closeables.clear();
    await Promise.allSettled(pools.map((pool) => pool.end()));
  };

  return memoryServiceFor;
}

export async function run(argv = [], env = process.env) {
  let merged;
  let config;
  let oauthConfig;
  try {
    ({ config, env: merged } = loadServeConfig(argv, env));
    oauthConfig = loadOAuthConfig(merged);
  } catch (err) {
    process.stderr.write(`Server config error: ${err.message}\n`);
    return 2;
  }

  const registry = await openRegistry({ dbPath: config.registryPath });
  const tenantService = createTenantService({ store: registry.tenants });
  const userService = createUserService({ store: registry.users });
  const oauthService = oauthConfig.enabled
    ? createOAuthService({ config: oauthConfig, registry, userService })
    : null;
  const oauthRouter = createOAuthRouter({ oauthService });
  const memoryFactory = createTenantMemoryStoreFactory(registry);
  const agentActivity = createAgentActivity({ trace: (event) => registry.oauth.recordTrace(event) });
  // The console is served by this local process and uses its own origin.
  const consoleOpts = {};
  if (merged.ALFRED_CONSOLE_DIR) consoleOpts.consoleDirOverride = merged.ALFRED_CONSOLE_DIR;
  const consoleRouter = createConsoleRouter({
    userService, tenantService, config,
    getMemoryService: memoryFactory, agentActivity,
    ...consoleOpts,
    registry,
    oauthService,
    sharedUrl: merged.ALFRED_SAAS_DATABASE_URL ?? null
  });
  const openapiRouter = createOpenapiRouter({
    userService,
    getMemoryService: memoryFactory,
    agentActivity,
    searchServiceFactory: null,  // v0.4.1: keyword fallback only; semantic+hybrid in v0.4.0 wired separately
    projectRoot: process.cwd(),
    registry,
    oauthService,
    requireAuth: true,
    allowedOrigins: config.allowedOrigins
  });
  const mcpRouter = createMcpRouter({
    oauthService,
    getMemoryService: memoryFactory,
    agentActivity,
    publicUrl: oauthConfig.enabled ? oauthConfig.publicUrl : (merged.ALFRED_PUBLIC_URL ?? "http://localhost"),
    challengeToken: merged.ALFRED_OPENAI_APPS_CHALLENGE ?? null,
    trace: (event) => registry.oauth.recordTrace(event)
  });
  const app = createApp({
    tenantService,
    memoryService: null,  // unused; we route per-tenant
    userService,
    config,
    consoleRouter,
    agentActivity,
    openapiRouter,
    oauthRouter,
    mcpRouter,
    registry
  });

  let server;
  try {
    server = await startServer({ app, config, consoleRouter });
  } catch (err) {
    await memoryFactory.close();
    registry.close();
    throw err;
  }
  const actualPort = server.address().port;
  const host = config.bind === "::1" ? "[::1]" : config.bind;
  process.stderr.write(`alfred-memory listening on http://${host}:${actualPort} (local)\n`);
  process.stderr.write(`console: http://${host}:${actualPort}/console/\n`);
  process.stderr.write(`registry: ${registry.dbPath}\n`);
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write("\nshutting down\n");
    server.close(() => {
      void memoryFactory.close()
        .finally(() => {
          try { registry.close(); } catch {}
          process.exit(0);
        });
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
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
