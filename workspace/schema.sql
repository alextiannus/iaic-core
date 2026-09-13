CREATE TABLE IF NOT EXISTS iaic_workspace_heads (
 application_id text NOT NULL, assistant_id text NOT NULL, subject_id text NOT NULL,
 path text NOT NULL, revision integer NOT NULL CHECK (revision > 0), deleted boolean NOT NULL DEFAULT false,
 PRIMARY KEY(application_id,assistant_id,subject_id,path)
);
CREATE TABLE IF NOT EXISTS iaic_workspace_versions (
 application_id text NOT NULL, assistant_id text NOT NULL, subject_id text NOT NULL,
 path text NOT NULL, revision integer NOT NULL CHECK (revision > 0),
 content text NOT NULL, media_type text NOT NULL, digest text NOT NULL, source jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(application_id,assistant_id,subject_id,path,revision),
 FOREIGN KEY(application_id,assistant_id,subject_id,path) REFERENCES iaic_workspace_heads(application_id,assistant_id,subject_id,path)
);
