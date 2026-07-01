// Schema Provisioner for SaaS Web Onboarding.
//
// When a new tenant signs up via POST /console/api/bootstrap, we need to
// give them a logical database inside the shared Postgres cluster. The
// choice in v0.3.1 is "schema-per-tenant": one Postgres schema named
// tenant_<id> inside the cluster pointed to by ALFRED_SAAS_DATABASE_URL.
//
// Why schema and not a separate database:
//   * Cheaper to provision (no CREATE DATABASE privilege needed).
//   * Easier to backup (pg_dump --schema=tenant_<id>).
//   * Same operational cluster, same connection pool, same auth.
//
// The provisioner takes a `pgClient` (a function that returns a connected
// client) so tests can inject a mock. In production it uses node-postgres
// (`pg`), which is the same driver the rest of Alfred Memory uses.
//
// What it does:
//   1. CREATE SCHEMA IF NOT EXISTS tenant_<id>
//   2. SET search_path TO tenant_<id>, public
//   3. Apply the per-tenant migrations:
//        - alfred_memory_users
//        - alfred_memories (with namespace, type, etc.)
//        - alfred_sessions
//        - alfred_topics
//        - alfred_acceptance_criteria
//   4. Returns the connection string for the tenant (with search_path set
//      via the `options` URL parameter, so each Pool that opens it is
//      automatically scoped to the schema).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MIG_DIR = resolve(here, "..", "..", "migrations", "per-tenant-postgres");

// SQL strings for the per-tenant tables. Kept inline so the provisioner
// has zero filesystem dependencies in the hot path; tests can pass
// custom SQL via the `tenantMigrations` option.
export const DEFAULT_TENANT_MIGRATIONS = {
  "alfred_memory_users": `
    CREATE TABLE IF NOT EXISTS alfred_memory_users (
      id TEXT PRIMARY KEY,
      api_key_hash TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `,
  "alfred_memories": `
    CREATE TABLE IF NOT EXISTS alfred_memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES alfred_memory_users(id) ON DELETE CASCADE,
      namespace TEXT NOT NULL DEFAULT 'personal' CHECK (
        length(namespace) <= 120
        AND namespace ~ '^[a-z0-9][a-z0-9:_-]{0,119}$'
        AND namespace !~ '::'
        AND namespace !~ ':$'
        AND (namespace !~ '^(project|team):' OR namespace ~ '^(project|team):[a-z0-9][a-z0-9_-]*$')
      ),
      project_id TEXT,
      type TEXT NOT NULL CHECK (type IN ('preference', 'fact', 'decision', 'workflow', 'project', 'correction', 'source')),
      content TEXT NOT NULL,
      tags TEXT[] NOT NULL DEFAULT '{}',
      source TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      confidence DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS alfred_memories_user_created_idx
      ON alfred_memories(user_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS alfred_memories_user_namespace_created_idx
      ON alfred_memories(user_id, namespace, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS alfred_memories_user_type_idx
      ON alfred_memories(user_id, type);
    CREATE INDEX IF NOT EXISTS alfred_memories_user_namespace_type_idx
      ON alfred_memories(user_id, namespace, type);
    CREATE INDEX IF NOT EXISTS alfred_memories_user_project_idx
      ON alfred_memories(user_id, project_id);
    CREATE INDEX IF NOT EXISTS alfred_memories_tags_idx
      ON alfred_memories USING GIN(tags);
  `,
  "alfred_sessions": `
    CREATE TABLE IF NOT EXISTS alfred_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES alfred_memory_users(id) ON DELETE CASCADE,
      parent_session_id TEXT REFERENCES alfred_sessions(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'archived')),
      summary TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS alfred_sessions_user_idx
      ON alfred_sessions(user_id, started_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS alfred_sessions_status_idx
      ON alfred_sessions(status);
  `,
  "alfred_topics": `
    CREATE TABLE IF NOT EXISTS alfred_topics (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES alfred_memory_users(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES alfred_sessions(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'archived')),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS alfred_topics_user_idx
      ON alfred_topics(user_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS alfred_topics_session_idx
      ON alfred_topics(session_id);
  `,
  "alfred_acceptance_criteria": `
    CREATE TABLE IF NOT EXISTS alfred_acceptance_criteria (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES alfred_memory_users(id) ON DELETE CASCADE,
      topic_id TEXT REFERENCES alfred_topics(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'met', 'failed', 'skipped')),
      evidence TEXT,
      verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS alfred_ac_user_idx
      ON alfred_acceptance_criteria(user_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS alfred_ac_topic_idx
      ON alfred_acceptance_criteria(topic_id);
  `
};

function schemaNameFor(tenantId) {
  if (typeof tenantId !== "string" || !/^usr_t_[a-f0-9]{32}$/.test(tenantId)) {
    throw new Error(`Invalid tenant id for schema: ${tenantId}`);
  }
  return `tenant_${tenantId.replace(/^usr_t_/, "")}`;
}

// Build a tenant-scoped connection URL from the shared cluster URL by
// adding the search_path via the `options` query parameter. node-postgres
// passes `options` to the backend as `-c <key>=<value>` for every new
// connection, so each Pool opened with this URL is automatically scoped
// to the tenant's schema.
function buildTenantConnectionString(sharedUrl, schemaName) {
  if (typeof sharedUrl !== "string" || !sharedUrl.startsWith("postgres")) {
    throw new Error("sharedUrl must be a postgres:// or postgresql:// connection string");
  }
  const url = new URL(sharedUrl);
  const options = url.searchParams.get("options") || "";
  const tenantOption = `-c search_path=${schemaName},public`;
  const merged = options ? `${options},${tenantOption}` : tenantOption;
  url.searchParams.set("options", merged);
  return url.toString();
}

export function createSchemaProvisioner({ pgClient, tenantMigrations = DEFAULT_TENANT_MIGRATIONS } = {}) {
  if (typeof pgClient !== "function") {
    throw new TypeError("createSchemaProvisioner requires a pgClient function");
  }

  return {
    schemaNameFor,
    buildTenantConnectionString,

    async provision({ tenantId, sharedUrl }) {
      const schema = schemaNameFor(tenantId);
      const tenantConn = buildTenantConnectionString(sharedUrl, schema);
      const client = await pgClient({ connectionString: tenantConn });
      try {
        // 1. Create the schema.
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
        // 2. Set search_path so subsequent DDL lands in the tenant schema.
        await client.query(`SET search_path TO "${schema}", public`);
        // 3. Apply per-tenant migrations in order.
        for (const [name, sql] of Object.entries(tenantMigrations)) {
          await client.query(sql);
        }
        return { schema, connectionString: tenantConn };
      } finally {
        // pgClient returns a client we must close.
        if (typeof client.end === "function") {
          await client.end();
        }
      }
    }
  };
}
