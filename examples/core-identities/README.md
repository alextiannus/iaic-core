# Independent Agent identities

Install `@immedi/iaic-core` and `pg`, set `DATABASE_URL` to isolated PostgreSQL and run `node run.mjs`. The example creates and drops its own schema. Three application-provided principals have separate durable identities and capabilities. All run in one Runtime. The fixture verifies role binding and persistence, not real-model business outcomes or external Platform Agent authentication.
