CREATE TABLE IF NOT EXISTS iaic_notifications (
 id uuid PRIMARY KEY, namespace text NOT NULL, scope_id text NOT NULL,
 request_key text NOT NULL, recipient_id text NOT NULL, channel text NOT NULL,
 message jsonb NOT NULL, source jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','delivered','failed','unknown','cancelled')),
 attempt uuid, lease_until timestamptz, result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(namespace,scope_id,request_key)
);
CREATE TABLE IF NOT EXISTS iaic_notification_attempts (
 attempt uuid PRIMARY KEY, notification_id uuid NOT NULL REFERENCES iaic_notifications(id),
 state text NOT NULL, result jsonb,
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
