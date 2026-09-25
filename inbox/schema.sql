CREATE TABLE IF NOT EXISTS iaic_inbox (
 id uuid PRIMARY KEY, namespace text NOT NULL, scope_id text NOT NULL,
 sequence bigserial NOT NULL, request_key text NOT NULL, document jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz, archived_at timestamptz, version integer NOT NULL DEFAULT 1,
 UNIQUE(namespace,scope_id,request_key)
);
CREATE INDEX IF NOT EXISTS iaic_inbox_page ON iaic_inbox(namespace,scope_id,sequence DESC);
CREATE TABLE IF NOT EXISTS iaic_inbox_projections (
 id uuid PRIMARY KEY, namespace text NOT NULL, scope_id text NOT NULL, item_id uuid NOT NULL REFERENCES iaic_inbox(id),
 kind text NOT NULL CHECK(kind IN ('conversation','task')), request_key text NOT NULL,
 state text NOT NULL CHECK(state IN ('sending','unknown','delivered','not_sent')),
 attempt uuid NOT NULL, lease_until timestamptz, result jsonb,
 UNIQUE(namespace,scope_id,kind,request_key)
);
CREATE TABLE IF NOT EXISTS iaic_inbox_projection_history (
 sequence bigserial PRIMARY KEY, projection_id uuid NOT NULL REFERENCES iaic_inbox_projections(id),
 state text NOT NULL, attempt uuid NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
