-- Alfred Memory Server v0.4.0
-- Email verification tokens (SaaS Web Onboarding, optional)
--
-- One row per pending verification. The token is 32 chars of base64url
-- randomness. expires_at is checked at verify time. used_at is set
-- exactly once on successful verification.

CREATE TABLE IF NOT EXISTS tenant_email_verifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tenant_email_verifications_tenant_idx
  ON tenant_email_verifications(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS tenant_email_verifications_token_idx
  ON tenant_email_verifications(token);
