CREATE TABLE IF NOT EXISTS alfred_memory_users (
  id TEXT PRIMARY KEY,
  api_key_hash TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alfred_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES alfred_memory_users(id) ON DELETE CASCADE,
  project_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('preference', 'fact', 'decision', 'workflow', 'project', 'correction', 'source')),
  content TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  source TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  search_vector TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(content, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(source, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(project_id, '')), 'C') ||
    setweight(to_tsvector('simple', array_to_string(tags, ' ')), 'C') ||
    setweight(to_tsvector('simple', metadata::text), 'D')
  ) STORED
);

CREATE INDEX IF NOT EXISTS alfred_memories_user_created_idx ON alfred_memories(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS alfred_memories_user_type_idx ON alfred_memories(user_id, type);
CREATE INDEX IF NOT EXISTS alfred_memories_user_project_idx ON alfred_memories(user_id, project_id);
CREATE INDEX IF NOT EXISTS alfred_memories_tags_idx ON alfred_memories USING GIN(tags);
CREATE INDEX IF NOT EXISTS alfred_memories_search_idx ON alfred_memories USING GIN(search_vector);
