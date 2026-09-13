CREATE TABLE IF NOT EXISTS iaic_ingested_knowledge_sources (
 namespace text NOT NULL, source_id text NOT NULL,
 revision bigint NOT NULL CHECK(revision>0 AND revision<=9007199254740991),
 metadata jsonb, digest text, withdrawn boolean NOT NULL DEFAULT false,
 PRIMARY KEY(namespace,source_id),
 CHECK((withdrawn AND metadata IS NULL AND digest IS NULL) OR (NOT withdrawn AND metadata IS NOT NULL AND digest IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS iaic_ingested_knowledge_chunks (
 namespace text NOT NULL, id text NOT NULL, source_id text NOT NULL,
 part integer NOT NULL CHECK(part>=0), content text NOT NULL,
 byte_start integer NOT NULL, byte_end integer NOT NULL CHECK(byte_end>byte_start),
 PRIMARY KEY(namespace,id), UNIQUE(namespace,source_id,part),
 FOREIGN KEY(namespace,source_id) REFERENCES iaic_ingested_knowledge_sources(namespace,source_id)
);
