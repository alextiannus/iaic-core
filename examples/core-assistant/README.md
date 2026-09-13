# Core Assistant reference

A headless personal-work task combines persistent memory, an installed Skill and Workspace using the same reusable assistant.run capability as ImmediToday. It reads a stored writing preference and a drafting method, writes a checklist and returns a verified reference. A small application verifier checks the document format and required content as well as successful source/tool reads.

Run with an isolated SUBMISSION_TEST_DATABASE_URL: `node examples/core-assistant/run.mjs`. Temporary schema and Skill fixture are removed in finally. Default model is deterministic; DEMO_MODEL_API_KEY, DEMO_MODEL and optional DEMO_PROVIDER/DEMO_BASE_URL enable a separate real-model run. No production database, business writes or platform allowance grants are used. `npm run verify:core-package` executes this example after installing a tarball outside the source tree.

This is a bounded capability/quality example, not proof of all Assistant behavior or business-task correctness. The real app must supply its own outcome verifiers and broader evaluation cases.
