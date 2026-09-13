CREATE TABLE IF NOT EXISTS iaic_event_subscriptions (
 application_id text NOT NULL, assistant_id text NOT NULL, subject_id text NOT NULL,
 subscription_key text NOT NULL, prefix text NOT NULL, cursor bigint NOT NULL DEFAULT 0 CHECK(cursor>=0),
 PRIMARY KEY(application_id,assistant_id,subject_id,subscription_key)
);
