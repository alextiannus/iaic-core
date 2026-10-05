# Support observation and original-reporter follow-up

Run `SUBMISSION_TEST_DATABASE_URL=<isolated PostgreSQL URL> node examples/core-support-follow-up/run.mjs` after installation. The example creates and drops its own schema. It uses real Core PostgreSQL persistence, Support lifecycle and Notifications, with explicitly synthetic Host observation, deployment and channel evidence; it is not production or real-model acceptance.

The Host restores distinct subject IDs for humans and agents, validates current scope and source facts, and supplies an engineering actor limited to its authorized support scope. Agent candidates cannot impersonate users. An end-user resolution remains in the durable event stream until the scheduled resolution consumer admits its original-reporter notification. Schedule this consumer and the Notifications worker as part of enabling resolution; keep a stable consumer ID across restarts. Delivery and human read evidence are independent. A historical notification after reopen is marked historical.

See `support/README.md` for migration, receipt reconciliation, source bindings and Host responsibilities.
