CREATE TABLE IF NOT EXISTS iaic_memories (
 application_id text NOT NULL, assistant_id text NOT NULL, subject_id text NOT NULL,
 memory_key text NOT NULL, kind text NOT NULL CHECK(kind IN ('fact','preference','note')),
 content text, source jsonb, revision integer NOT NULL DEFAULT 1,
 expires_at timestamptz, deleted boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(application_id,assistant_id,subject_id,memory_key),
 CHECK((deleted AND content IS NULL AND source IS NULL) OR (NOT deleted AND content IS NOT NULL AND source IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS iaic_memory_imports (
 application_id text NOT NULL, assistant_id text NOT NULL, subject_id text NOT NULL,
 request_key text NOT NULL, request_digest text NOT NULL, receipt jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(application_id,assistant_id,subject_id,request_key)
);

ALTER TABLE iaic_memories ADD COLUMN IF NOT EXISTS dispute jsonb;

ALTER TABLE iaic_memories ADD COLUMN IF NOT EXISTS assessment jsonb;
