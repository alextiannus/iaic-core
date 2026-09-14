CREATE TABLE IF NOT EXISTS iaic_peer_records (
 namespace text NOT NULL, kind text NOT NULL, id text NOT NULL,
 data jsonb NOT NULL, PRIMARY KEY(namespace,kind,id)
);
CREATE TABLE IF NOT EXISTS iaic_peer_audit (
 seq bigserial PRIMARY KEY, namespace text NOT NULL, channel_id text NOT NULL,
 kind text NOT NULL, actor jsonb NOT NULL, data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS iaic_peer_channel_audit ON iaic_peer_audit(namespace,channel_id,seq);
