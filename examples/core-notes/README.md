# Core Notes reference application

A small CLI application, with no ERP or UI. It defines its own identity and two capabilities, saves a writing preference, reads it back, verifies the Agent result, reloads the persisted task and exports memory. Tables use a temporary PostgreSQL schema removed in `finally`.

From the repository, set `SUBMISSION_TEST_DATABASE_URL` to the isolated test database and run `node examples/core-notes/run.mjs`. For actual package isolation, run `npm run verify:core-package`; it copies this example into a fresh directory after installing the packed Core tarball.

The default provider is deterministic and makes no external model calls. For a separate real-model run, set `DEMO_MODEL_API_KEY`, `DEMO_MODEL`, optionally `DEMO_PROVIDER=chat-completions` and `DEMO_BASE_URL`. The key is used only in memory. This uses the application's model credential, not a fabricated BYOK account or a platform allowance grant. Do not run against a production database.
