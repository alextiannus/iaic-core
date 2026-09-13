CREATE TABLE IF NOT EXISTS iaic_allowance_budgets (
 application_id text NOT NULL,subject_id text NOT NULL,id text NOT NULL,
 terms jsonb NOT NULL,revoked boolean NOT NULL DEFAULT false,
 PRIMARY KEY(application_id,subject_id,id),
 FOREIGN KEY(application_id,subject_id) REFERENCES iaic_token_accounts
);
