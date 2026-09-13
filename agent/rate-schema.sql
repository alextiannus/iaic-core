CREATE TABLE IF NOT EXISTS iaic_model_rate_pools (
 namespace text PRIMARY KEY,
 requests_per_minute integer NOT NULL CHECK(requests_per_minute>0),
 tokens_per_minute bigint NOT NULL CHECK(tokens_per_minute>0 AND tokens_per_minute<=9007199254740991)
);
CREATE TABLE IF NOT EXISTS iaic_model_rate_reservations (
 id uuid PRIMARY KEY,namespace text NOT NULL REFERENCES iaic_model_rate_pools(namespace),
 task_id text NOT NULL,turn integer NOT NULL CHECK(turn>0),window_start timestamptz NOT NULL,
 reserved_tokens bigint NOT NULL CHECK(reserved_tokens>0 AND reserved_tokens<=9007199254740991),
 actual_tokens bigint CHECK(actual_tokens>=0 AND actual_tokens<=9007199254740991),
 state text NOT NULL CHECK(state IN ('reserved','settled','not-called')),evidence jsonb,
 UNIQUE(namespace,task_id,turn)
);
CREATE INDEX IF NOT EXISTS iaic_model_rate_window ON iaic_model_rate_reservations(namespace,window_start);

-- Existing pools keep zero spacing. Older receipts are conservatively dated at
-- migration time; this never proves that an unknown provider call has finished.
ALTER TABLE iaic_model_rate_pools ADD COLUMN IF NOT EXISTS minimum_interval_ms integer NOT NULL DEFAULT 0 CHECK(minimum_interval_ms>=0 AND minimum_interval_ms<=60000);
ALTER TABLE iaic_model_rate_reservations ADD COLUMN IF NOT EXISTS admitted_at timestamptz NOT NULL DEFAULT clock_timestamp();
CREATE INDEX IF NOT EXISTS iaic_model_rate_spacing ON iaic_model_rate_reservations(namespace,admitted_at DESC) WHERE state<>'not-called';
