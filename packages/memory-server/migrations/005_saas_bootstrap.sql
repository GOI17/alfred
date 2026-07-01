-- Alfred Memory Server v0.3.1
-- SaaS Web Onboarding: rate-limit state for POST /console/api/bootstrap.
--
-- This migration adds ONE table to the alfred_registry control plane:
-- bootstrap_attempts. It records every signup attempt with the source IP
-- and timestamp, so the rate limiter can count attempts in the last N
-- minutes from a given IP.
--
-- Why a table and not in-memory state:
--   * Multi-process: a horizontally-scaled SaaS shares the registry.
--   * Audit: an operator can SELECT who tried to sign up, when, and how
--     many times, to spot abuse.
--   * Reset: TRUNCATE bootstrap_attempts clears the throttle immediately
--     in an emergency without restarting the server.

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
