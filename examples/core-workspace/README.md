# Core Workspace reference

A minimal headless Agent application using the public Core package. It writes a Markdown checklist through the same Workspace tool contract available to application users, reads back the exact artifact reference and verifies the result. The harness then checks old-version reads after an edit and reference invalidation after deletion.

Set SUBMISSION_TEST_DATABASE_URL to disposable PostgreSQL and run `node examples/core-workspace/run.mjs`. `npm run verify:core-package` installs a Core tarball in a fresh directory and runs both workspace and memory examples. Default execution uses a deterministic model. For a separate real-model run, supply DEMO_MODEL_API_KEY, DEMO_MODEL, and optional DEMO_PROVIDER/DEMO_BASE_URL. A temporary database schema is created and removed in finally. Never point this example at a production database.

This verifies an actual tool/task/artifact chain, not general model quality or complete User Assistant acceptance. It adds no UI, ERP integration or platform allowance grant.
