ALTER TABLE iaic_calls ADD COLUMN IF NOT EXISTS action_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS iaic_calls_action_ref ON iaic_calls(task_id,action_ref) WHERE action_ref IS NOT NULL;
