# Independent completion trigger

Install `@immedi/iaic-core` and `pg`, set `DATABASE_URL` to isolated PostgreSQL and run `node run.mjs`. The example creates/drops its schema and completes a synthetic source through TaskStore's existing executor port. A replacement deferred worker observes the terminal source and submits exactly one follow-up. No model or application API is invoked; application/real-model verification is separate.
