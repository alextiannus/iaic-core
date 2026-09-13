CREATE TABLE IF NOT EXISTS iaic_subscriptions (
 namespace text NOT NULL, scope_id text NOT NULL,
 revision integer NOT NULL, snapshot jsonb NOT NULL,
 source_id text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(namespace,scope_id)
);
CREATE TABLE IF NOT EXISTS iaic_subscription_sources (
 namespace text NOT NULL, source_id text NOT NULL,
 scope_id text NOT NULL, payload text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(namespace,source_id)
);
