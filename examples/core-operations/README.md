# Read-only Agent operations foundation

Run `SUBMISSION_TEST_DATABASE_URL=... node examples/core-operations/run.mjs` on
isolated PostgreSQL. The example creates/drops a random schema. It reads a real
TaskStore admission through typed-neutral operations ports and the ordinary
CapabilityDispatcher, with one internal and one external Host Agent descriptor.

The example deliberately has **no real Worker probe or external connector**.
Missing internal telemetry and a stale external self-report remain unknown, not
healthy. The model binding comes from the real Task but actualModel is null because
no inference occurred. The illustrative Review request is labelled reported, not
an independently verified peer review. It proves source/projection composition,
not full Platform Team collaboration or a production dashboard. Task state remains
unchanged after observation and revoked reads are denied.

Applications replace the explicit ports with currently authorized module reads and
Host telemetry. Do not use this fixture directory as a production identity service.
Default UI, independently paginated traces/interactions, real Agent adapters and
application acceptance remain separate work; see operations/README.md.
