CREATE TABLE IF NOT EXISTS iaic_recurring_tasks (
 id uuid PRIMARY KEY, application_id text NOT NULL, assistant_id text NOT NULL, subject_id text NOT NULL,
 request_key text NOT NULL, first_at timestamptz NOT NULL, interval_seconds integer NOT NULL CHECK(interval_seconds>=60),
 occurrence_count integer CHECK(occurrence_count>0), input jsonb NOT NULL,
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','paused','cancelled','completed','blocked')),
 revision integer NOT NULL DEFAULT 1, last_sequence integer NOT NULL DEFAULT -1,
 pending_sequence integer, last_intent_id uuid, skipped_count integer NOT NULL DEFAULT 0,
 token uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0, last_error text NOT NULL DEFAULT '',
 next_attempt_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(application_id,assistant_id,subject_id,request_key)
);
