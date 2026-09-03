-- Alfred Memory Server issue #148
-- Server-validated post-recovery continuation. The emailed recovery link
-- remains unchanged; only this internal canonical path is persisted.

ALTER TABLE tenant_recoveries
  ADD COLUMN IF NOT EXISTS continuation_path TEXT;
