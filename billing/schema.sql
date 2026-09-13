CREATE TABLE IF NOT EXISTS iaic_token_accounts (
 application_id text NOT NULL, subject_id text NOT NULL,
 PRIMARY KEY(application_id,subject_id)
);
CREATE TABLE IF NOT EXISTS iaic_token_calls (
 application_id text NOT NULL, subject_id text NOT NULL, request_id text NOT NULL,
 mode text NOT NULL CHECK(mode IN ('SYSTEM_MANAGED','BYOK')),
 reserved numeric(30,0) NOT NULL CHECK(reserved>=0),
 price jsonb NOT NULL, attribution jsonb NOT NULL,
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','unknown','settled','released')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(application_id,subject_id,request_id),
 FOREIGN KEY(application_id,subject_id) REFERENCES iaic_token_accounts
);
CREATE TABLE IF NOT EXISTS iaic_token_entries (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 application_id text NOT NULL, subject_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('grant','settlement','release','unknown')),
 reference text NOT NULL, delta numeric(30,0) NOT NULL,
 evidence jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(application_id,subject_id,kind,reference),
 FOREIGN KEY(application_id,subject_id) REFERENCES iaic_token_accounts
);
CREATE TABLE IF NOT EXISTS iaic_token_issuances (
 application_id text NOT NULL, source_id text NOT NULL, subject_id text NOT NULL,
 amount numeric(30,0) NOT NULL CHECK(amount>0), evidence jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(application_id,source_id),
 FOREIGN KEY(application_id,subject_id) REFERENCES iaic_token_accounts
);

CREATE TABLE IF NOT EXISTS iaic_token_reconciliations (
 application_id text NOT NULL, source_id text NOT NULL, subject_id text NOT NULL,
 request_id text NOT NULL, evidence jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(application_id,source_id),
 UNIQUE(application_id,subject_id,request_id),
 FOREIGN KEY(application_id,subject_id,request_id) REFERENCES iaic_token_calls
);

ALTER TABLE iaic_token_calls ADD COLUMN IF NOT EXISTS budget jsonb;
