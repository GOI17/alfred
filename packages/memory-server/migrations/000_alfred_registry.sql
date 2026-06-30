-- Alfred Memory Server v0.3.0
-- Control plane: alfred_registry. One SQLite file per Alfred installation,
-- typically at ~/.alfred/registry.sqlite.
--
-- This schema models THREE independent concepts:
--   * tenants    -- a universe of data with one physical DB
--   * workspaces -- a directory on disk where an agent invokes Alfred Memory
--   * tenant_access -- many-to-many binding of workspaces to tenants
--
-- Storage selection invariants are enforced at the DB level:
--   * human_agent / hybrid_with_human tenants MUST use Postgres
--   * db_path is set iff storage_backend = sqlite
--   * db_connection is set iff storage_backend = postgres
--   * Two distinct Postgres tenants cannot coexist in a workspace chain
--   * Tenants with non-inherited readers cannot be deleted

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  workspace_init_id TEXT,                       -- nullable: orphan tenants allowed
  display_name TEXT,
  kind TEXT NOT NULL CHECK (kind IN (
    'human_agent',
    'coding_agent_only',
    'hybrid_with_human',
    'server_managed',
    'archived'
  )),
  storage_backend TEXT NOT NULL CHECK (storage_backend IN ('sqlite', 'postgres')),
  db_path TEXT,                                 -- set when storage_backend = sqlite
  db_connection TEXT,                           -- set when storage_backend = postgres
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,                      -- when kind moves to 'archived'
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Hosting policy: human agents MUST use Postgres (Rule 1)
  CHECK (
    (kind NOT IN ('human_agent', 'hybrid_with_human'))
    OR (storage_backend = 'postgres')
  ),

  -- Hosting policy: db_path XOR db_connection by backend (Rule 5)
  CHECK (
    (storage_backend = 'sqlite' AND db_path IS NOT NULL AND db_connection IS NULL)
    OR (storage_backend = 'postgres' AND db_connection IS NOT NULL AND db_path IS NULL)
  ),

  -- Hosting policy: server_managed tenants MUST use Postgres (Rule 3)
  CHECK (
    (kind <> 'server_managed')
    OR (storage_backend = 'postgres')
  )
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  workspace_hash TEXT NOT NULL UNIQUE,          -- sha256 of normalized absolute path
  workspace_path TEXT NOT NULL,
  parent_workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS workspaces_parent_idx ON workspaces(parent_workspace_id);

CREATE TABLE IF NOT EXISTS tenant_access (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  access TEXT NOT NULL CHECK (access IN ('owner', 'reader', 'none')),
  inherited BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS tenant_access_workspace_idx ON tenant_access(workspace_id);
CREATE INDEX IF NOT EXISTS tenant_access_tenant_idx ON tenant_access(tenant_id);
CREATE INDEX IF NOT EXISTS tenant_access_inherited_idx ON tenant_access(tenant_id, inherited);

CREATE TABLE IF NOT EXISTS tenant_api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_prefix TEXT NOT NULL,                    -- e.g. "alk_7f3a..." for indexed lookup
  key_hash TEXT NOT NULL,
  key_algorithm TEXT NOT NULL DEFAULT 'scrypt',
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  UNIQUE (tenant_id, key_prefix)
);

CREATE INDEX IF NOT EXISTS tenant_api_keys_active_idx
  ON tenant_api_keys(tenant_id, revoked_at);

CREATE INDEX IF NOT EXISTS tenant_api_keys_prefix_idx
  ON tenant_api_keys(key_prefix);

CREATE TABLE IF NOT EXISTS tenant_trace (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  event TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tenant_trace_tenant_idx ON tenant_trace(tenant_id, created_at DESC);

-- =============================================================================
-- TRIGGER 1: prevent_tenant_delete_with_readers
-- Workspace Policy Invariant W5
-- =============================================================================
CREATE OR REPLACE FUNCTION prevent_tenant_delete_with_readers()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM tenant_access
    WHERE tenant_id = OLD.id
      AND access = 'reader'
      AND inherited = FALSE
  ) THEN
    RAISE EXCEPTION 'Cannot delete tenant %: has non-inherited readers', OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenant_delete_block ON tenants;
CREATE TRIGGER tenant_delete_block
  BEFORE DELETE ON tenants
  FOR EACH ROW EXECUTE FUNCTION prevent_tenant_delete_with_readers();

-- =============================================================================
-- TRIGGER 2: check_no_dual_postgres_in_hierarchy
-- Workspace Policy Invariant W6
-- =============================================================================
CREATE OR REPLACE FUNCTION check_no_dual_postgres_in_hierarchy()
RETURNS TRIGGER AS $$
DECLARE
  current_workspace workspaces%ROWTYPE;
BEGIN
  -- Only check when the new access is owner and the tenant is Postgres
  IF NEW.access = 'owner'
     AND (SELECT storage_backend FROM tenants WHERE id = NEW.tenant_id) = 'postgres' THEN

    current_workspace := (SELECT * FROM workspaces WHERE id = NEW.workspace_id);

    WHILE current_workspace.parent_workspace_id IS NOT NULL LOOP
      current_workspace := (SELECT * FROM workspaces WHERE id = current_workspace.parent_workspace_id);

      IF EXISTS (
        SELECT 1 FROM tenant_access ta
        JOIN tenants t ON t.id = ta.tenant_id
        WHERE ta.workspace_id = current_workspace.id
          AND ta.access = 'owner'
          AND t.storage_backend = 'postgres'
          AND t.id != NEW.tenant_id
      ) THEN
        RAISE EXCEPTION 'Cannot have two distinct Postgres tenants in this hierarchy';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenant_access_no_dual_pg ON tenant_access;
CREATE TRIGGER tenant_access_no_dual_pg
  BEFORE INSERT OR UPDATE ON tenant_access
  FOR EACH ROW EXECUTE FUNCTION check_no_dual_postgres_in_hierarchy();

-- =============================================================================
-- TRIGGER 3: bump_tenant_updated_at
-- Standard timestamp bump on tenants row updates
-- =============================================================================
CREATE OR REPLACE FUNCTION bump_tenant_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenants_bump_updated_at ON tenants;
CREATE TRIGGER tenants_bump_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION bump_tenant_updated_at();
