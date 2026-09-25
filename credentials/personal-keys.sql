CREATE TABLE IF NOT EXISTS iaic_personal_keys (
 namespace text NOT NULL, id uuid NOT NULL,
 account_id text NOT NULL, organization_id text,
 label text NOT NULL, capabilities jsonb NOT NULL,
 digest text NOT NULL, request_key text NOT NULL,
 created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 PRIMARY KEY(namespace,id), UNIQUE(namespace,account_id,request_key)
);
