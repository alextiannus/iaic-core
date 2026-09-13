CREATE TABLE IF NOT EXISTS iaic_monitor_cycles (
 namespace text NOT NULL,owner text NOT NULL,request_key text NOT NULL,channel text NOT NULL,
 state text NOT NULL CHECK(state IN ('started','prepared','completed')),
 snapshot jsonb,snapshot_digest text,result jsonb,result_digest text,
 PRIMARY KEY(namespace,owner,request_key)
);
