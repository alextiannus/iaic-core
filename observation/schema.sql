CREATE TABLE IF NOT EXISTS iaic_observations(namespace text NOT NULL,source_id text NOT NULL,release_id text NOT NULL,observed_at timestamptz NOT NULL,digest text NOT NULL,record jsonb NOT NULL,PRIMARY KEY(namespace,source_id));
CREATE INDEX IF NOT EXISTS iaic_observation_window ON iaic_observations(namespace,release_id,observed_at,source_id);
CREATE TABLE IF NOT EXISTS iaic_observation_assessments(namespace text NOT NULL,id text NOT NULL,record jsonb NOT NULL,PRIMARY KEY(namespace,id));
