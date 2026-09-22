CREATE TABLE IF NOT EXISTS iaic_support_issues (
 namespace text NOT NULL, scope_id text NOT NULL, id uuid NOT NULL,
 reporter_id text NOT NULL, request_key text NOT NULL, report jsonb NOT NULL,
 state text NOT NULL DEFAULT 'received', revision integer NOT NULL DEFAULT 1,
 PRIMARY KEY(namespace,scope_id,id), UNIQUE(namespace,scope_id,reporter_id,request_key),
 CHECK(state IN ('received','triaged','fixing','verifying','resolved','closed','reopened'))
);
CREATE TABLE IF NOT EXISTS iaic_support_events (
 namespace text NOT NULL, scope_id text NOT NULL, issue_id uuid NOT NULL,
 revision integer NOT NULL, state text NOT NULL, actor_id text NOT NULL,
 message text NOT NULL, evidence jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(namespace,scope_id,issue_id,revision),
 FOREIGN KEY(namespace,scope_id,issue_id) REFERENCES iaic_support_issues(namespace,scope_id,id)
);
