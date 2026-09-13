CREATE TABLE IF NOT EXISTS iaic_releases (
 namespace text NOT NULL,id text NOT NULL,digest text NOT NULL,record jsonb NOT NULL,
 disabled boolean NOT NULL DEFAULT false,PRIMARY KEY(namespace,id)
);
CREATE TABLE IF NOT EXISTS iaic_release_channels (
 namespace text NOT NULL,name text NOT NULL,revision integer NOT NULL,
 stable_id text NOT NULL,canary_id text,percentage integer NOT NULL,
 PRIMARY KEY(namespace,name),
 FOREIGN KEY(namespace,stable_id) REFERENCES iaic_releases(namespace,id),
 FOREIGN KEY(namespace,canary_id) REFERENCES iaic_releases(namespace,id)
);
CREATE TABLE IF NOT EXISTS iaic_release_events (
 sequence bigserial PRIMARY KEY,namespace text NOT NULL,actor_ref text NOT NULL,
 action text NOT NULL,data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS iaic_release_rollback_receipt ON iaic_release_events
(namespace,(data->'before'->>'name'),(data->'before'->>'revision'),(data->'evidence'->>'assessmentId')) WHERE action='rollback';
