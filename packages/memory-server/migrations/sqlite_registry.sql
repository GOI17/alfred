-- SQLite registry schema for Alfred Memory Server v0.3.0.
-- The Postgres twin is ./000_alfred_registry.sql. This file is for local
-- registries used by the SQLite-backed CLI (`alfred` default) and the
-- single-process self-hosted server.
--
-- Enforced invariants (same as the Postgres version):
--   * human_agent / hybrid_with_human / server_managed MUST use Postgres
--   * db_path set when storage_backend = sqlite (and db_connection NULL)
--   * db_connection set when storage_backend = postgres (and db_path NULL)
--   * Blocking delete on tenants with non-inherited readers (TRIGGER 1)
--   * No dual distinct Postgres tenants in a workspace chain (TRIGGER 2)
--   * updated_at auto-bump on tenants.UPDATE
--
-- Storage-layout choices (differ from Postgres because of column types and
-- engine limitations):
--   * All timestamps are TEXT in ISO-8601 format
--   * metadata is TEXT (JSON-encoded)
--   * json_each is unavailable for tag filtering, so we store tags as JSON
--     and filter at the JS layer (acceptable for local registries)

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  workspace_init_id TEXT,
  display_name TEXT,
  kind TEXT NOT NULL CHECK (kind IN (
    'human_agent',
    'coding_agent_only',
    'hybrid_with_human',
    'server_managed',
    'archived'
  )),
  storage_backend TEXT NOT NULL CHECK (storage_backend IN ('sqlite', 'postgres')),
  db_path TEXT,
  db_connection TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',

  -- Hosting policy: human agents / hybrid / server_managed -> Postgres
  CHECK (
    (kind NOT IN ('human_agent', 'hybrid_with_human', 'server_managed'))
    OR (storage_backend = 'postgres')
  ),

  -- Hosting policy: db_path XOR db_connection by backend
  CHECK (
    (storage_backend = 'sqlite' AND db_path IS NOT NULL AND db_connection IS NULL)
    OR (storage_backend = 'postgres' AND db_connection IS NOT NULL AND db_path IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  workspace_hash TEXT NOT NULL UNIQUE,
  workspace_path TEXT NOT NULL,
  parent_workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS workspaces_parent_idx ON workspaces(parent_workspace_id);

CREATE TABLE IF NOT EXISTS tenant_access (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  access TEXT NOT NULL CHECK (access IN ('owner', 'reader', 'none')),
  inherited INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (workspace_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS tenant_access_tenant_idx ON tenant_access(tenant_id);

CREATE TABLE IF NOT EXISTS tenant_api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_algorithm TEXT NOT NULL DEFAULT 'scrypt',
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at TEXT,
  revoked_at TEXT,
  UNIQUE (tenant_id, key_prefix)
);

CREATE INDEX IF NOT EXISTS tenant_api_keys_prefix_idx ON tenant_api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS tenant_api_keys_active_idx ON tenant_api_keys(tenant_id, revoked_at);

CREATE TABLE IF NOT EXISTS tenant_trace (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  event TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- =============================================================================
-- TRIGGER 1: prevent_tenant_delete_with_readers
-- =============================================================================
CREATE TRIGGER IF NOT EXISTS tenant_delete_block
  BEFORE DELETE ON tenants
  FOR EACH ROW
  WHEN EXISTS (
    SELECT 1 FROM tenant_access
    WHERE tenant_id = OLD.id AND access = 'reader' AND inherited = 0
  )
BEGIN
  SELECT RAISE(ABORT, 'Cannot delete tenant: has non-inherited readers');
END;

-- =============================================================================
-- TRIGGER 2: check_no_dual_postgres_in_hierarchy
-- =============================================================================
CREATE TRIGGER IF NOT EXISTS tenant_access_no_dual_pg_insert
  BEFORE INSERT ON tenant_access
  FOR EACH ROW
  WHEN NEW.access = 'owner'
       AND (SELECT storage_backend FROM tenants WHERE id = NEW.tenant_id) = 'postgres'
       AND EXISTS (
         WITH RECURSIVE chain(id) AS (
           SELECT parent_workspace_id FROM workspaces WHERE id = NEW.workspace_id
           UNION
           SELECT w.parent_workspace_id FROM workspaces w JOIN chain c ON w.id = c.id
         )
         SELECT 1 FROM tenant_access ta
         JOIN tenants t ON t.id = ta.tenant_id
         JOIN chain c ON c.id = ta.workspace_id
         WHERE ta.access = 'owner'
           AND t.storage_backend = 'postgres'
           AND t.id != NEW.tenant_id
       )
BEGIN
  SELECT RAISE(ABORT, 'Cannot have two distinct Postgres tenants in this hierarchy');
END;

CREATE TRIGGER IF NOT EXISTS tenant_access_no_dual_pg_update
  BEFORE UPDATE ON tenant_access
  FOR EACH ROW
  WHEN NEW.access = 'owner'
       AND (SELECT storage_backend FROM tenants WHERE id = NEW.tenant_id) = 'postgres'
       AND EXISTS (
         WITH RECURSIVE chain(id) AS (
           SELECT parent_workspace_id FROM workspaces WHERE id = NEW.workspace_id
           UNION
           SELECT w.parent_workspace_id FROM workspaces w JOIN chain c ON w.id = c.id
         )
         SELECT 1 FROM tenant_access ta
         JOIN tenants t ON t.id = ta.tenant_id
         JOIN chain c ON c.id = ta.workspace_id
         WHERE ta.access = 'owner'
           AND t.storage_backend = 'postgres'
           AND t.id != NEW.tenant_id
       )
BEGIN
  SELECT RAISE(ABORT, 'Cannot have two distinct Postgres tenants in this hierarchy');
END;

-- =============================================================================
-- TRIGGER 3: bump_tenant_updated_at
-- =============================================================================
CREATE TABLE IF NOT EXISTS __tenants_update_buffer (
  tenant_id TEXT PRIMARY KEY,
  ts TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS tenants_queue_update
  AFTER UPDATE ON tenants
  FOR EACH ROW
BEGIN
  INSERT OR REPLACE INTO __tenants_update_buffer(tenant_id, ts)
    VALUES (OLD.id, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER IF NOT EXISTS tenants_apply_update
  AFTER UPDATE ON tenants
  FOR EACH ROW
  WHEN (SELECT ts FROM __tenants_update_buffer WHERE tenant_id = OLD.id) IS NOT NULL
BEGIN
  UPDATE tenants
     SET updated_at = (SELECT ts FROM __tenants_update_buffer WHERE tenant_id = OLD.id)
   WHERE id = OLD.id;
  DELETE FROM __tenants_update_buffer WHERE tenant_id = OLD.id;
END;

-- =============================================================================
-- v0.3.1: SaaS Web Onboarding rate-limit state
-- See ../000_alfred_registry.sql and ./005_saas_bootstrap.sql for context.
-- =============================================================================
CREATE TABLE IF NOT EXISTS bootstrap_attempts (
  id TEXT PRIMARY KEY,
  ip TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  display_name TEXT,
  kind TEXT,
  result TEXT NOT NULL CHECK (result IN ('success', 'validation_error', 'rate_limited', 'config_error', 'internal_error')),
  tenant_id TEXT,
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS bootstrap_attempts_ip_time_idx
  ON bootstrap_attempts(ip, attempted_at DESC);

CREATE INDEX IF NOT EXISTS bootstrap_attempts_time_idx
  ON bootstrap_attempts(attempted_at DESC);

-- =============================================================================
-- v0.4.0: Email verification tokens
-- =============================================================================
CREATE TABLE IF NOT EXISTS tenant_email_verifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS tenant_email_verifications_tenant_idx
  ON tenant_email_verifications(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS tenant_email_verifications_token_idx
  ON tenant_email_verifications(token);

-- =============================================================================
-- v0.4.0: Forgot-my-key recovery tokens
-- =============================================================================
CREATE TABLE IF NOT EXISTS tenant_recoveries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  new_key_id TEXT,
  old_key_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS tenant_recoveries_tenant_idx
  ON tenant_recoveries(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS tenant_recoveries_token_idx
  ON tenant_recoveries(token);

-- =============================================================================
-- v0.4.0: Memory embeddings (local model, semantic search)
-- =============================================================================
CREATE TABLE IF NOT EXISTS memory_embeddings (
  memory_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  embedding BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS memory_embeddings_tenant_idx
  ON memory_embeddings(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS memory_embeddings_model_idx
  ON memory_embeddings(model);
