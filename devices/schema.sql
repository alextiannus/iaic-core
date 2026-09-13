CREATE TABLE IF NOT EXISTS iaic_device_operations (
 namespace text NOT NULL,owner text NOT NULL,request_key text NOT NULL,device_id text NOT NULL,
 digest text NOT NULL,action_type text NOT NULL,result jsonb,
 PRIMARY KEY(namespace,owner,request_key)
);
CREATE INDEX IF NOT EXISTS iaic_device_pending ON iaic_device_operations(namespace,device_id) WHERE result IS NULL;
