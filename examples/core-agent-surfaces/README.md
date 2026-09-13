# Persistent Agent lifecycle across protocol surfaces

Run `SUBMISSION_TEST_DATABASE_URL=postgresql://... node examples/core-agent-surfaces/run.mjs` against an isolated PostgreSQL database. The fixture creates and removes a random schema; HTTP/A2A bind only loopback, and MCP uses official SDK in-memory transport. No real model or external business system is used.

One stable request is submitted through ESM, HTTP SDK, raw HTTP, MCP and official A2A. The same Task waits for input, accepts clarification through MCP, then finishes through reconstructed Runtime objects and a source-backed verifier. All entries read the same final result. A separate Task reads a source before waiting; revoking that source blocks result reads but A2A cancellation remains possible through the metadata-only state binding. Revoking Task access then blocks all result surfaces.

This demonstrates reusable controls and a common persistent lifecycle. It does not prove actual process-kill recovery, real-model goal competence, UI behavior, A2A context continuation/streaming or full list pagination. The fixture's deterministic provider uses durable Task turns and verifies the persisted clarification reached its context. The list binding explicitly rejects unsupported filter/pagination input.
