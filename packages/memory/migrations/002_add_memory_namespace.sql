ALTER TABLE alfred_memories
  ADD COLUMN IF NOT EXISTS namespace TEXT;

UPDATE alfred_memories
SET namespace = CASE
  WHEN project_id IS NOT NULL AND length(lower(project_id)) <= 112 AND lower(project_id) ~ '^[a-z0-9][a-z0-9_-]*$' THEN 'project:' || lower(project_id)
  ELSE 'personal'
END
WHERE namespace IS NULL;

ALTER TABLE alfred_memories
  ALTER COLUMN namespace SET DEFAULT 'personal',
  ALTER COLUMN namespace SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'alfred_memories_namespace_check'
      AND conrelid = 'alfred_memories'::regclass
  ) THEN
    ALTER TABLE alfred_memories
      ADD CONSTRAINT alfred_memories_namespace_check CHECK (
        length(namespace) <= 120
        AND namespace ~ '^[a-z0-9][a-z0-9:_-]{0,119}$'
        AND namespace !~ '::'
        AND namespace !~ ':$'
        AND (namespace !~ '^(project|team):' OR namespace ~ '^(project|team):[a-z0-9][a-z0-9_-]*$')
      );
  END IF;
END $$;

DROP INDEX IF EXISTS alfred_memories_search_idx;
ALTER TABLE alfred_memories DROP COLUMN IF EXISTS search_vector;

CREATE INDEX IF NOT EXISTS alfred_memories_user_namespace_created_idx ON alfred_memories(user_id, namespace, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS alfred_memories_user_namespace_type_idx ON alfred_memories(user_id, namespace, type);
