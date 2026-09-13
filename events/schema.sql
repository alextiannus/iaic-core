CREATE TABLE IF NOT EXISTS iaic_events (
 id uuid PRIMARY KEY, application_id text NOT NULL, assistant_id text NOT NULL, subject_id text NOT NULL,
 event_key text NOT NULL, data jsonb NOT NULL, source jsonb NOT NULL, digest text NOT NULL,
 published_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(application_id,assistant_id,subject_id,event_key)
);
