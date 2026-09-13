CREATE TABLE IF NOT EXISTS iaic_accounts (
 namespace text NOT NULL, id text NOT NULL,
 state text NOT NULL CHECK (state IN ('active','suspended')),
 profile jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(profile)='object'),
 revision integer NOT NULL CHECK (revision > 0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(namespace,id)
);
CREATE TABLE IF NOT EXISTS iaic_organizations (
 namespace text NOT NULL, id text NOT NULL,
 state text NOT NULL CHECK (state IN ('active','suspended')),
 profile jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(profile)='object'),
 revision integer NOT NULL CHECK (revision > 0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(namespace,id)
);
CREATE TABLE IF NOT EXISTS iaic_memberships (
 namespace text NOT NULL, organization_id text NOT NULL, account_id text NOT NULL,
 state text NOT NULL CHECK (state IN ('active','removed')),
 roles jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(roles)='array'),
 revision integer NOT NULL CHECK (revision > 0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(namespace,organization_id,account_id),
 FOREIGN KEY(namespace,organization_id) REFERENCES iaic_organizations(namespace,id),
 FOREIGN KEY(namespace,account_id) REFERENCES iaic_accounts(namespace,id)
);
