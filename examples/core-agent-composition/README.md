# Basic Agent composition

A headless host composes three fixture Agent roles using the same Runtime and existing modules. Each has an injected Memory/Workspace scope, model configuration and billing account. Identical keys and paths remain separate. A Business model preference change persists without changing other Agents or an already admitted task.

Run `npm run verify:core-package` with an isolated `SUBMISSION_TEST_DATABASE_URL`. The verifier packs and independently installs Core, then runs this example without ERP or model credentials. PostgreSQL schemas and synthetic data are removed on completion. Assertions validate resource boundaries, scoped tool admission, three durable identities, pinned model continuity and fixture platform-unit settlement. No real provider is called; this is not semantic evaluation or production principal provisioning.
