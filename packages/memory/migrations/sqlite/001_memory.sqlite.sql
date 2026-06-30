CREATE TABLE IF NOT EXISTS alfred_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  namespace TEXT NOT NULL DEFAULT 'personal',
  project_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('preference','fact','decision','workflow','project','correction','source')),
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  confidence REAL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS alfred_memories_user_created_idx ON alfred_memories(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS alfred_memories_user_namespace_created_idx ON alfred_memories(user_id, namespace, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS alfred_memories_user_type_idx ON alfred_memories(user_id, type);
CREATE INDEX IF NOT EXISTS alfred_memories_user_namespace_type_idx ON alfred_memories(user_id, namespace, type);
CREATE INDEX IF NOT EXISTS alfred_memories_user_project_idx ON alfred_memories(user_id, project_id);
CREATE INDEX IF NOT EXISTS alfred_memories_tags_idx ON alfred_memories(tags);
