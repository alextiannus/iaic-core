CREATE TABLE IF NOT EXISTS iaic_sessions (
 id uuid PRIMARY KEY, application_id text NOT NULL, assistant_id text NOT NULL, subject_id text NOT NULL,
 request_key text NOT NULL, title text NOT NULL, sequence integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(application_id,assistant_id,subject_id,request_key)
);
CREATE TABLE IF NOT EXISTS iaic_session_events (
 session_id uuid NOT NULL REFERENCES iaic_sessions(id), sequence integer NOT NULL,
 request_key text NOT NULL, expected_sequence integer, kind text NOT NULL CHECK(kind IN ('user_message','task_ref')),
 data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(session_id,sequence), UNIQUE(session_id,request_key)
);

ALTER TABLE iaic_sessions ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','closed'));
ALTER TABLE iaic_session_events DROP CONSTRAINT IF EXISTS iaic_session_events_kind_check;
ALTER TABLE iaic_session_events ADD CONSTRAINT iaic_session_events_kind_check CHECK(kind IN ('user_message','task_ref','session_state','resource_ref'));
