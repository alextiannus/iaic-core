CREATE TABLE IF NOT EXISTS iaic_agent_identities (
 id uuid PRIMARY KEY,
 application_id text NOT NULL,
 definition_id text NOT NULL,
 subject_id text NOT NULL,
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','paused')),
 revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(application_id,definition_id,subject_id)
);
CREATE TABLE IF NOT EXISTS iaic_agent_identity_events (
 agent_id uuid NOT NULL REFERENCES iaic_agent_identities(id),
 revision integer NOT NULL,
 state text NOT NULL CHECK(state IN ('active','paused')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(agent_id,revision)
);
