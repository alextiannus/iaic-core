CREATE TABLE IF NOT EXISTS iaic_operations_agents (
 namespace text NOT NULL, id text NOT NULL, descriptor jsonb NOT NULL,
 revision bigint NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(namespace,id)
);
CREATE TABLE IF NOT EXISTS iaic_operations_presence (
 namespace text NOT NULL, executor_id text NOT NULL, generation uuid NOT NULL,
 sequence bigint NOT NULL DEFAULT 0, observed_at timestamptz, valid_until timestamptz,
 basis text NOT NULL DEFAULT 'observed', state text NOT NULL DEFAULT 'unknown', reason text NOT NULL DEFAULT 'not-reported',
 PRIMARY KEY(namespace,executor_id)
);
