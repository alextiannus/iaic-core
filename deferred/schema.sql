CREATE TABLE IF NOT EXISTS iaic_deferred_tasks (
 id uuid PRIMARY KEY, application_id text NOT NULL, assistant_id text NOT NULL, subject_id text NOT NULL,
 request_key text NOT NULL, due_at timestamptz NOT NULL, input jsonb NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','dispatching','retry','dispatched','blocked','cancelled')),
 token uuid, lease_until timestamptz, admitted_at timestamptz, attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), task_id uuid, last_error text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(application_id,assistant_id,subject_id,request_key)
);
CREATE INDEX IF NOT EXISTS iaic_deferred_due ON iaic_deferred_tasks(due_at,next_attempt_at) WHERE state IN ('queued','retry','dispatching');
ALTER TABLE iaic_deferred_tasks ADD COLUMN IF NOT EXISTS trigger jsonb;
ALTER TABLE iaic_deferred_tasks ADD COLUMN IF NOT EXISTS trigger_receipt jsonb;
-- Conditional intents stay outside legacy time-only workers' due_at scan.
ALTER TABLE iaic_deferred_tasks ADD COLUMN IF NOT EXISTS trigger_not_before timestamptz;
