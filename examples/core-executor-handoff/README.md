# Independent executor handoff consumer

Run `node examples/core-executor-handoff/run.mjs` with Node20, installed
`@immedi/iaic-core`, `pg` and isolated `DATABASE_URL`. Creates/drops its own schema.
Two Runtime instances share durable Tasks; the new host requests the observed
executor's drain, the old host completes admitted work then retires, and the new
host handles the queued Task without marking normal work interrupted.

See [host lifecycle and SIGTERM composition](../../agent/EXECUTOR_HANDOFF.md).
No Render API, live provider, tenant business rule, secret or production Task is
used. Usage reconciliation is a separate trusted host port; see
[the installed reconciliation example](../core-usage-reconciliation/README.md).
