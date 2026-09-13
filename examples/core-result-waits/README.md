# Independent result-wait consumer

Run with an installed `@immedi/iaic-core`, `pg`, Node20 and `DATABASE_URL` pointing to a test PostgreSQL database. `run.mjs` creates and drops an isolated schema. A fixture receipt read suspends a Task, a new Runtime observes it pending without model calls, and readiness resumes the same Task. No application, ERP, UI or provider dependency. `npm run verify:core-package` runs this against the packed and independently installed Core.
