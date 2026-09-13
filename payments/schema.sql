CREATE TABLE IF NOT EXISTS iaic_money_invoices (
 id uuid PRIMARY KEY, namespace text NOT NULL, scope_id text NOT NULL, source_id text NOT NULL,
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), amount numeric(30,0) NOT NULL CHECK(amount>0),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(namespace,scope_id,source_id)
);
CREATE TABLE IF NOT EXISTS iaic_money_operations (
 id uuid PRIMARY KEY, namespace text NOT NULL, scope_id text NOT NULL, request_key text NOT NULL,
 invoice_id uuid NOT NULL REFERENCES iaic_money_invoices(id), kind text NOT NULL CHECK(kind IN('charge','refund')),
 payment_id uuid REFERENCES iaic_money_operations(id), currency text NOT NULL, amount numeric(30,0) NOT NULL CHECK(amount>0),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','running','unknown','succeeded','failed')),
 result jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(namespace,scope_id,request_key)
);
CREATE INDEX IF NOT EXISTS iaic_money_invoice_operations ON iaic_money_operations(invoice_id,created_at);
CREATE TABLE IF NOT EXISTS iaic_money_events (
 seq bigserial PRIMARY KEY, operation_id uuid NOT NULL REFERENCES iaic_money_operations(id),
 kind text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
