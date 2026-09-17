# Independent Host context consumer

With Node20, installed `@immedi/iaic-core`, `pg` and isolated `DATABASE_URL`, run
`node examples/core-host-context/run.mjs`. It creates its own application snapshot
and Task schema, separates a spoofed user field from Host-projected information,
reconstructs a Runtime, checks current revision, and rejects context switching,
revocation and cross-subject reads. No live provider or business write is used.

See [the port and migration contract](../../context/HOST.md). The separately
installed strict consumer in `examples/core-types-consumer/consumer.mts` compiles
and executes the public Host context declarations; full Agent starter declarations
are not implied by this example.
