CREATE TABLE IF NOT EXISTS iaic_handoffs (
 id uuid PRIMARY KEY, application_id text NOT NULL, subject_id text NOT NULL,
 request_key text NOT NULL, parent_task_id uuid NOT NULL,
 terms jsonb NOT NULL, input jsonb NOT NULL,
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','active','cancelled','expired','finished')),
 admitted_at timestamptz, child_task_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), reconciled_at timestamptz,
 UNIQUE(application_id,subject_id,request_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS iaic_handoffs_active_parent ON iaic_handoffs(application_id,subject_id,parent_task_id) WHERE state IN ('prepared','active');
CREATE TABLE IF NOT EXISTS iaic_handoff_model_calls (
 handoff_id uuid NOT NULL REFERENCES iaic_handoffs(id), task_id uuid NOT NULL,
 turn integer NOT NULL CHECK(turn>0), admitted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(handoff_id,task_id,turn)
);

CREATE INDEX IF NOT EXISTS iaic_handoffs_parent_history ON iaic_handoffs(application_id,subject_id,parent_task_id,created_at DESC,id DESC);
