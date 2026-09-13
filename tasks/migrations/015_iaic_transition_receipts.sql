CREATE TABLE IF NOT EXISTS iaic_task_transition_receipts (
 task_id uuid NOT NULL REFERENCES iaic_tasks(id) ON DELETE CASCADE,
 request_key text NOT NULL,
 request_digest text NOT NULL,
 action text NOT NULL CHECK (action IN ('resume','provide_input')),
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(task_id,request_key)
);
