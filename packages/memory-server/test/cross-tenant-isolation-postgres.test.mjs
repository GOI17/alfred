// Cross-tenant isolation test using a real Postgres cluster.
//
// This test is opt-in: it only runs when ALFRED_TEST_POSTGRES_URL is set.
// In CI, .github/workflows/ci-postgres.yml sets this env var. In local
// dev or in tests without Postgres, the test is skipped.
//
// What it verifies (one vector, real DB):
//   1. Provision two tenants via createBootstrap + createSchemaProvisioner.
//   2. Insert a memory in tenant A's schema.
//   3. Query tenant B's schema for that memory.
//   4. Expect: 0 rows.

import { test } from "node:test";
import assert from "node:assert/strict";

const POSTGRES_URL = process.env.ALFRED_TEST_POSTGRES_URL;
const SHOULD_RUN = Boolean(POSTGRES_URL);

const skipMsg = "ALFRED_TEST_POSTGRES_URL not set; skipping real-Postgres isolation test (run via ci-postgres.yml).";

test("cross-tenant isolation: tenant A's rows are invisible from tenant B's schema", { skip: SHOULD_RUN ? false : skipMsg }, async () => {
  // Lazy import to avoid loading pg in environments that don't have it.
  const pg = (await import("pg")).default;
  const { createInMemoryTenantStore, createInMemoryUserStore, createTenantService, createUserService } = await import("../../memory/src/index.js");
  const { createBootstrap, createSchemaProvisioner, createRateLimiter } = await import("../src/bootstrap/index.js");

  // ---- Setup: in-memory tenant + user stores + a fake registry ----
  const tenantStore = createInMemoryTenantStore();
  const userStore = createInMemoryUserStore();
  const _orig = tenantStore.createTenant.bind(tenantStore);
  tenantStore.createTenant = async (input) => { const t = await _orig(input); await userStore.addTenantStub(t); return t; };
  const tenantService = createTenantService({ store: tenantStore });
  const userService = createUserService({ store: userStore });
  const attempts = [];
  const registry = {
    async recordBootstrapAttempt(input) { attempts.push(input); return { id: input.id }; },
    async countBootstrapAttempts() { return 0; },
    async oldestBootstrapAttemptInWindow() { return null; }
  };

  // ---- Setup: pg client (lazy) ----
  let pgClient = null;
  async function getPgClient() {
    if (pgClient) return pgClient;
    pgClient = new pg.Client({ connectionString: POSTGRES_URL });
    await pgClient.connect();
    return pgClient;
  }

  // ---- Setup: provisioner that uses real pg ----
  const provisioner = createSchemaProvisioner({
    pgClient: async ({ connectionString }) => {
      const c = new pg.Client({ connectionString });
      await c.connect();
      return c;
    }
  });

  // ---- Setup: schema provisioner (real pg) ----
  const bs = createBootstrap({
    tenantService, userService,
    rateLimiter: createRateLimiter({ registry }),
    schemaProvisioner: provisioner,
    sharedUrl: POSTGRES_URL
  });

  // ---- Provision two tenants ----
  const a = await bs.createTenantAndFirstKey({ ip: "1.1.1.1", displayName: "tenant-a", kind: "human_agent" });
  const b = await bs.createTenantAndFirstKey({ ip: "2.2.2.2", displayName: "tenant-b", kind: "human_agent" });
  assert.ok(a.tenant.id);
  assert.ok(b.tenant.id);
  assert.notEqual(a.tenant.id, b.tenant.id);

  // ---- Insert a memory in tenant A's schema ----
  const clientA = await getPgClient();
  // The connection string for tenant A already has search_path set in db_connection.
  // We need a fresh client that uses that search_path.
  const clientATenant = new pg.Client({ connectionString: a.tenant.db_connection });
  await clientATenant.connect();
  await clientATenant.query(`
    INSERT INTO alfred_memory_users (id) VALUES ($1) ON CONFLICT DO NOTHING
  `, [a.tenant.id]);
  await clientATenant.query(`
    INSERT INTO alfred_memories (id, user_id, type, content, source)
    VALUES ($1, $2, $3, $4, $5)
  `, ["mem_test_a", a.tenant.id, "fact", "Tenant A secret memory", "test"]);
  await clientATenant.end();

  // ---- Query tenant B's schema for the same memory id ----
  const clientBTenant = new pg.Client({ connectionString: b.tenant.db_connection });
  await clientBTenant.connect();
  const result = await clientBTenant.query(`
    SELECT id, content FROM alfred_memories WHERE id = $1
  `, ["mem_test_a"]);
  await clientBTenant.end();

  assert.equal(result.rows.length, 0, "Tenant A's memory leaked into Tenant B's schema");

  // Cleanup: drop both schemas. Use the provisioner's schemaNameFor() to derive
  // the schema name from each tenant id, not a string-parse of the connection
  // URL (which is percent-encoded by URL.toString()).
  const cleanup = await getPgClient();
  const schemaA = provisioner.schemaNameFor(a.tenant.id);
  const schemaB = provisioner.schemaNameFor(b.tenant.id);
  await cleanup.query(`DROP SCHEMA IF EXISTS "${schemaA}" CASCADE`);
  await cleanup.query(`DROP SCHEMA IF EXISTS "${schemaB}" CASCADE`);
  await cleanup.end();
});
