-- Alfred Memory Server v0.4.0
-- Forgot-my-key recovery tokens
--
-- One row per pending recovery. expires_at is 1 hour. used_at marks
-- successful consumption. Each row corresponds to a new API key that
-- replaces the old one (the old key is revoked atomically at the
-- same time).

CREATE TABLE IF NOT EXISTS tenant_recoveries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  new_key_id TEXT,
  old_key_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tenant_recoveries_tenant_idx
  ON tenant_recoveries(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS tenant_recoveries_token_idx
  ON tenant_recoveries(token);
