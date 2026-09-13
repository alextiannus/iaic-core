CREATE TABLE IF NOT EXISTS iaic_execution_journal (
 namespace text NOT NULL,
 id text NOT NULL,
 digest text NOT NULL,
 receipt jsonb NOT NULL,
 result jsonb,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(namespace,id)
);
CREATE INDEX IF NOT EXISTS iaic_execution_pending ON iaic_execution_journal(namespace,updated_at);
