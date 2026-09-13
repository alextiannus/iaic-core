# Session example

Install the Core tarball and `pg`, set an isolated `DATABASE_URL`, then run `run.mjs` with Node 20. The example verifies a durable scoped conversation timeline, repeat-safe message append and a context snapshot unaffected by later messages. No ERP or UI is required. The package verifier runs it alongside the existing examples.
