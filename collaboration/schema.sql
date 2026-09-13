CREATE TABLE IF NOT EXISTS iaic_delegation_grants (
 namespace text NOT NULL,id text NOT NULL,digest text NOT NULL,terms jsonb NOT NULL,
 revoked boolean NOT NULL DEFAULT false,PRIMARY KEY(namespace,id)
);
CREATE TABLE IF NOT EXISTS iaic_delegation_calls (
 namespace text NOT NULL,grant_id text NOT NULL,call_id text NOT NULL,
 effect_key text NOT NULL,capability text NOT NULL,input_digest text NOT NULL,outcome text NOT NULL DEFAULT 'admitted',
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(namespace,grant_id,call_id),
 FOREIGN KEY(namespace,grant_id) REFERENCES iaic_delegation_grants(namespace,id)
);
CREATE TABLE IF NOT EXISTS iaic_delegation_model_calls (
 namespace text NOT NULL,grant_id text NOT NULL,attempt_id text NOT NULL,
 task_id text NOT NULL,turn integer NOT NULL CHECK(turn>0),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(namespace,grant_id,attempt_id),
 FOREIGN KEY(namespace,grant_id) REFERENCES iaic_delegation_grants(namespace,id)
);
