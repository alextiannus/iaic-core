CREATE TABLE IF NOT EXISTS iaic_tasks (
 id uuid PRIMARY KEY, employee_id text NOT NULL, erp_user text NOT NULL,
 capability text NOT NULL, input jsonb NOT NULL, request_key text NOT NULL,
 version text NOT NULL, model text NOT NULL,
 status text NOT NULL CHECK(status IN ('queued','running','waiting','succeeded','failed','cancelled')),
 waiting_reason text CHECK(waiting_reason IN ('input','external_result','interrupted','limit')),
 executor_token uuid, result jsonb, error text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(employee_id,erp_user,capability,request_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS iaic_single_running_task ON iaic_tasks ((true)) WHERE status='running';
CREATE TABLE IF NOT EXISTS iaic_task_events (
 seq bigserial PRIMARY KEY, task_id uuid NOT NULL REFERENCES iaic_tasks(id),
 kind text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS iaic_calls (
 id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES iaic_tasks(id),
 capability text NOT NULL, input jsonb NOT NULL, effect text NOT NULL CHECK(effect IN ('read','write')),
 status text NOT NULL CHECK(status IN ('prepared','running','succeeded','failed','unknown')),
 result jsonb, error text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS iaic_task_event_lookup ON iaic_task_events(task_id,seq);
CREATE INDEX IF NOT EXISTS iaic_call_lookup ON iaic_calls(task_id,created_at);
