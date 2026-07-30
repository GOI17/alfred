ALTER TABLE alfred_memories
  ADD COLUMN IF NOT EXISTS attribution JSONB;

CREATE INDEX IF NOT EXISTS alfred_memories_attribution_harness_idx
  ON alfred_memories ((attribution->>'harness'));
