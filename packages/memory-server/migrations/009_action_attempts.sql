-- v0.4.1: Per-API-key rate limiting for Custom GPT Actions.
-- Stores attempts against /memories, /search, /agents/*, /skills/*,
-- /policies/check. One row per HTTP request, retained for audit + replay.

CREATE TABLE IF NOT EXISTS action_attempts (
  id              TEXT PRIMARY KEY,
  api_key_hash    TEXT NOT NULL,
  attempted_at    TEXT NOT NULL,
  endpoint        TEXT,
  method          TEXT,
  result          TEXT NOT NULL,
  error_code      TEXT
);

CREATE INDEX IF NOT EXISTS action_attempts_key_time_idx
  ON action_attempts (api_key_hash, attempted_at);

CREATE INDEX IF NOT EXISTS action_attempts_time_idx
  ON action_attempts (attempted_at);
