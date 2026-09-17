CREATE TABLE IF NOT EXISTS iaic_executor_ownership (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 generation bigint NOT NULL CHECK(generation > 0),
 owner_token uuid,
 state text NOT NULL CHECK(state IN ('active','draining','released')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
