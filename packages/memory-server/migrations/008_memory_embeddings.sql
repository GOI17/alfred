-- Alfred Memory Server v0.4.0
-- Memory embeddings for semantic search (local model, zero provider)
--
-- Each row is one embedding vector for one memory. The model is recorded
-- so we can re-embed with a newer model if needed. The embedding is
-- stored as a BLOB (Float32Array serialized to bytes).

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
