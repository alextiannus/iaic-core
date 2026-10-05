CREATE TABLE IF NOT EXISTS iaic_support_conversations (
 namespace text NOT NULL, scope_id text NOT NULL, issue_id uuid NOT NULL,
 reporter_id text NOT NULL, revision integer NOT NULL DEFAULT 1,
 initial jsonb NOT NULL, snapshot jsonb NOT NULL,
 PRIMARY KEY(namespace,scope_id,issue_id)
);
CREATE TABLE IF NOT EXISTS iaic_support_conversation_turns (
 namespace text NOT NULL, scope_id text NOT NULL, issue_id uuid NOT NULL,
 revision integer NOT NULL, request_key text NOT NULL,
 request jsonb NOT NULL, change jsonb NOT NULL, result jsonb NOT NULL,
 PRIMARY KEY(namespace,scope_id,issue_id,revision),
 UNIQUE(namespace,scope_id,issue_id,request_key),
 FOREIGN KEY(namespace,scope_id,issue_id) REFERENCES iaic_support_conversations(namespace,scope_id,issue_id)
);
