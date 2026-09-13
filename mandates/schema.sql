CREATE TABLE IF NOT EXISTS iaic_mandates (
 id uuid PRIMARY KEY,
 application_id text NOT NULL,
 assistant_id text NOT NULL,
 subject_id text NOT NULL,
 request_key text NOT NULL,
 capability text NOT NULL,
 tools jsonb NOT NULL,
 purpose text NOT NULL,
 expires_at timestamptz NOT NULL,
 source jsonb NOT NULL,
 digest text NOT NULL,
 granted_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 UNIQUE(application_id,assistant_id,subject_id,request_key)
);
