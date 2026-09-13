# Assistant module

This module owns persistent Assistant model preferences and resolution rules. Personal-work capability composition is independently documented in `TASKS.md` and implemented in `tasks.js`. It provides basic contracts, no UI, ERP identity mapping or deployment environment access.

For model configuration work, read `models.js`, `settings.js` and `test/iaic-assistant-models.test.js`. `AssistantModels` receives explicit interfaces: settings, system profiles, optional user models, ledger, trusted `resolveScope(actor)` and optional platform token policies. It imports only the billing wrapper. Credential encryption/validation belongs to `iaic/credentials`, and allowance transactions belong to `iaic/billing`.

Public operations: `snapshot(actor)`, `select(actor, selection)`, `resolve({actor, modelIdentity})`, `target(actor, profileId)`, `saveOwn(actor, input)` and `revokeOwn(actor, input)`. Resolution of an existing task uses its pinned identity; changing the default does not rewrite the task. BYOK has zero platform debit and never silently falls back. Task state changes remain owned by the task module; `target` resolves a selected model but does not modify a task.

Applications construct the module with their own actor-to-account resolver. ImmediToday's deployment adapter is `src/ai-native/model-configuration.js`; it assembles concrete stores, approved endpoints and secret references. Its central service delegates operations and combines model settings with wallet data for the existing application response. Model rules are not implemented in that central service.

Focused check: `node --test test/iaic-assistant-models.test.js`. It runs without ERP, a web server or database and verifies non-ERP identities, pinned model continuity, BYOK accounting and no fallback. Existing real PostgreSQL integration checks validate persistent settings, credentials and application wiring. Independent tarball installation and non-ERP reference applications have separate verification under `examples/`; these unit tests do not replace that verification.

System-managed resolution requires a platform allowance policy; absence is an explicit configuration error, not free/unmetered fallback. BYOK remains zero platform debit. Trusted issuance and top-up contracts are documented in `../billing/ISSUANCE.md`.
