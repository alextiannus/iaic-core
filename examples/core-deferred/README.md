# Independent deferred-task example

Install `@immedi/iaic-core` and `pg`, set `DATABASE_URL` to an isolated PostgreSQL instance, then run `node run.mjs`. The example creates and drops its own schema. A persisted intent is dispatched by a replacement worker into the generic TaskStore. It does not invoke a model or application API; Runtime outcome verification is covered separately by integration and production tests.
