CREATE TABLE IF NOT EXISTS alfred_memory_users (
  id TEXT PRIMARY KEY,
  api_key_hash TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE INDEX IF NOT EXISTS alfred_memories_user_created_idx ON alfred_memories(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS alfred_memories_user_namespace_created_idx ON alfred_memories(user_id, namespace, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS alfred_memories_user_type_idx ON alfred_memories(user_id, type);
CREATE INDEX IF NOT EXISTS alfred_memories_user_namespace_type_idx ON alfred_memories(user_id, namespace, type);
CREATE INDEX IF NOT EXISTS alfred_memories_user_project_idx ON alfred_memories(user_id, project_id);
CREATE INDEX IF NOT EXISTS alfred_memories_tags_idx ON alfred_memories USING GIN(tags);
