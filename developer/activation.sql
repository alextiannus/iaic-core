CREATE TABLE IF NOT EXISTS iaic_deployment_activations (
 namespace text NOT NULL,
 request_name text NOT NULL,
 configuration text NOT NULL,
 container_id text NOT NULL,
 admitted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(namespace,request_name)
);
