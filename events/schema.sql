CREATE TABLE IF NOT EXISTS iaic_events (
 id uuid PRIMARY KEY, application_id text NOT NULL, assistant_id text NOT NULL, subject_id text NOT NULL,
 event_key text NOT NULL, data jsonb NOT NULL, source jsonb NOT NULL, digest text NOT NULL,
 published_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(application_id,assistant_id,subject_id,event_key)
);
-- Initialize before enabling cursor consumers. Existing events receive a stable
-- enumeration; no historical wall-clock ordering is asserted by the backfill.
ALTER TABLE iaic_events ADD COLUMN IF NOT EXISTS event_sequence bigint GENERATED ALWAYS AS IDENTITY;
CREATE UNIQUE INDEX IF NOT EXISTS iaic_events_sequence ON iaic_events(event_sequence);
CREATE INDEX IF NOT EXISTS iaic_events_scope_sequence ON iaic_events(application_id,assistant_id,subject_id,event_sequence);
