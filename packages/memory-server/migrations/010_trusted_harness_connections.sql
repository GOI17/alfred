-- Alfred Memory Server: trusted harness connections.
-- PostgreSQL registry migration. SQLite registries use the same additive
-- column checks in sqlite-registry-store.js because SQLite lacks portable
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS support.

ALTER TABLE tenant_api_keys ADD COLUMN IF NOT EXISTS harness TEXT;
ALTER TABLE tenant_api_keys ADD COLUMN IF NOT EXISTS actor TEXT;

ALTER TABLE tenant_api_keys DROP CONSTRAINT IF EXISTS tenant_api_keys_connection_identity;
ALTER TABLE tenant_api_keys ADD CONSTRAINT tenant_api_keys_connection_identity
  CHECK ((harness IS NULL AND actor IS NULL) OR (harness IS NOT NULL AND actor IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS tenant_api_keys_active_harness_idx
  ON tenant_api_keys(tenant_id, harness)
  WHERE revoked_at IS NULL AND harness IS NOT NULL;
