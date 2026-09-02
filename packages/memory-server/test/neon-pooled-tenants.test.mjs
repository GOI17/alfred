import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createTenantMemoryStoreFactory,
  tenantPostgresSchema,
  withoutStartupOptions
} from "../scripts/serve.mjs";

const TENANT_ID = "usr_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TENANT_SCHEMA = "tenant_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("withoutStartupOptions keeps Neon pooler and TLS parameters", () => {
  const input = "postgresql://user:pass@ep-example-pooler.us-east-2.aws.neon.tech/db?sslmode=require&channel_binding=require&options=-c%20search_path%3Dtenant_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,public";
  const parsed = new URL(withoutStartupOptions(input));

  assert.equal(parsed.hostname, "ep-example-pooler.us-east-2.aws.neon.tech");
  assert.equal(parsed.searchParams.get("sslmode"), "require");
  assert.equal(parsed.searchParams.get("channel_binding"), "require");
  assert.equal(parsed.searchParams.has("options"), false);
});

test("tenantPostgresSchema supports metadata, legacy URLs, derived SaaS ids, and public tenants", () => {
  assert.equal(tenantPostgresSchema({ metadata: { schema: TENANT_SCHEMA } }), TENANT_SCHEMA);
  assert.equal(tenantPostgresSchema({
    db_connection: `postgres://u:p@h/d?options=-c%20search_path%3D${TENANT_SCHEMA},public`
  }), TENANT_SCHEMA);
  assert.equal(tenantPostgresSchema({ id: TENANT_ID }), TENANT_SCHEMA);
  assert.equal(tenantPostgresSchema({ id: "manual", db_connection: "postgres://u:p@h/d" }), "public");
  assert.throws(
    () => tenantPostgresSchema({ metadata: { schema: "bad-schema" } }),
    /safe lowercase identifier/
  );
});

test("tenant memory factory sanitizes legacy URLs and uses schema-qualified runtime queries", async () => {
  const factoryCalls = [];
  const queries = [];
  let ended = false;
  const tenant = {
    id: TENANT_ID,
    storage_backend: "postgres",
    metadata: { schema: TENANT_SCHEMA },
    db_connection: `postgresql://u:p@ep-example-pooler.neon.tech/d?sslmode=require&options=-c%20search_path%3D${TENANT_SCHEMA},public`
  };
  const registry = {
    tenants: {
      async getTenant(id) { return id === tenant.id ? tenant : null; }
    }
  };
  const memoryRow = {
    id: "memory-1",
    user_id: TENANT_ID,
    namespace: "personal",
    project_id: null,
    type: "fact",
    content: "Pooled runtime is schema-qualified.",
    tags: [],
    source: "test",
    metadata: {},
    confidence: null,
    expires_at: null,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z"
  };
  const memoryFactory = createTenantMemoryStoreFactory(registry, {
    postgresPoolFactory: async (options) => {
      factoryCalls.push(options);
      return {
        async query(text, values) {
          queries.push({ text, values });
          if (text.includes(`"${TENANT_SCHEMA}"."alfred_memories"`)) {
            return { rows: [memoryRow], rowCount: 1 };
          }
          return { rows: [], rowCount: 1 };
        },
        async end() { ended = true; }
      };
    }
  });

  const service = await memoryFactory(TENANT_ID);
  const created = await service.createMemory(TENANT_ID, {
    type: "fact",
    content: memoryRow.content,
    source: "test"
  });
  assert.equal(created.userId, TENANT_ID);
  assert.equal(factoryCalls.length, 1);
  const parsed = new URL(factoryCalls[0].connectionString);
  assert.match(parsed.hostname, /-pooler\./);
  assert.equal(parsed.searchParams.has("options"), false);
  assert.ok(queries[0].text.includes(`"${TENANT_SCHEMA}"."alfred_memory_users"`));
  assert.ok(queries[1].text.includes(`"${TENANT_SCHEMA}"."alfred_memories"`));

  await memoryFactory.close();
  assert.equal(ended, true);
});
