-- A Task keeps its immutable trusted identity snapshot. The Agent module owns
-- the live identity/lifecycle table; do not join it from Task storage.
ALTER TABLE iaic_tasks ADD COLUMN IF NOT EXISTS agent jsonb;
