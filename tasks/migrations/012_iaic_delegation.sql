ALTER TABLE iaic_tasks ADD COLUMN IF NOT EXISTS delegation jsonb;
CREATE INDEX IF NOT EXISTS iaic_task_pending_delegation ON iaic_tasks(version,id) WHERE status='waiting' AND waiting_reason='external_result' AND delegation IS NOT NULL;
