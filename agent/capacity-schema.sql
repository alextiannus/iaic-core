CREATE TABLE IF NOT EXISTS iaic_model_capacity_pools (
 namespace text PRIMARY KEY, capacity integer NOT NULL CHECK(capacity>0 AND capacity<=10000)
);
CREATE TABLE IF NOT EXISTS iaic_model_capacity_reservations (
 id uuid PRIMARY KEY, namespace text NOT NULL REFERENCES iaic_model_capacity_pools(namespace),
 task_id text NOT NULL, turn integer NOT NULL CHECK(turn>0),
 state text NOT NULL CHECK(state IN ('active','released')), evidence jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), released_at timestamptz,
 UNIQUE(namespace,task_id,turn)
);
CREATE INDEX IF NOT EXISTS iaic_model_capacity_active ON iaic_model_capacity_reservations(namespace,state);
