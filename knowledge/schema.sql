CREATE TABLE IF NOT EXISTS iaic_knowledge_documents (
 namespace text NOT NULL,
 id text NOT NULL,
 metadata jsonb NOT NULL,
 content text,
 revision bigint NOT NULL CHECK (revision > 0 AND revision <= 9007199254740991),
 withdrawn boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(namespace,id),
 CHECK ((withdrawn AND content IS NULL) OR (NOT withdrawn AND content IS NOT NULL))
);
