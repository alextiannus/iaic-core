# Expired payload cleanup

Run `SUBMISSION_TEST_DATABASE_URL=<isolated PostgreSQL> node examples/core-retention/run.mjs` with installed Core and pg. The example cleans current expired Memory, document Knowledge and ingested Knowledge payload through one independent RetentionSweep port, preserves revision tombstones and verifies an immediate repeat has no new erasures. It creates/drops a random schema and invokes no model. Read resources/RETENTION.md before enabling an application's retention policy; this does not erase Task/Session history, backups or external copies.
