# User Assistant Inbox composition

`SUBMISSION_TEST_DATABASE_URL=... node examples/core-inbox/run.mjs` runs an
isolated PostgreSQL fixture, including real Core TaskStore and SessionStore
projection, reconstructed services after lost receipts, profile configuration,
reviewed capability publication, order lookup, and current access revocation.

`SUBMISSION_TEST_DATABASE_URL=... node examples/core-inbox/server.mjs` prints a
loopback URL for a minimal Inbox + chat UI. The database must be local and isolated.
The server creates a random schema and drops it on SIGINT/SIGTERM. Hard termination
can leave that test schema; remove only the explicitly identified fixture schema.
The UI supports unread badge, list/detail, read/unread/archive, conversation
projection, unique review Task creation, workspace setup, natural-language service
description, explicit publish review and order viewing. It is a deterministic Host
interaction fixture, **not an LLM quality test**. It issues no production requests.

The `profile.*`, `capability.*`, `orders.*` names and one-table profile fixture are
owned by this example Host. The generic Core module contains none of those fields.
Existing User Assistant hosts can inject `createInboxCapabilities({inbox})` through
`openUserAssistant({extraCapabilities})`; their own model, Task admission policy,
identity resolver and business capabilities remain in charge. Receiving an Inbox
item never starts a Task automatically. The fixture explicitly creates a queued
review Task without running a business executor. Conversation stores only a
`resource_ref`; context resolves it through Inbox current authorization each time.

In a real Host, persist and validate immutable execution context and current
capability admission through the existing Runtime before creating Tasks. An absent
query result is `unknown` unless the Host can prove no outstanding request can
commit. Return `delivered` only after Task/context bindings have been reconciled.
The fixture does not complete the separate cross-store durable-wake work in note43.2.

Browser evidence in `evidence/` was captured from the local fixture on 2026-09-25.
To rerun, invoke `node examples/core-inbox/browser.mjs` with
`IAIC_BROWSER_HOST_PACKAGE` pointing at an independent package.json with
puppeteer-core, `IAIC_BROWSER_EXECUTABLE` pointing at Chrome,
`IAIC_BROWSER_EVIDENCE` set to a fresh output directory, and the isolated local
`SUBMISSION_TEST_DATABASE_URL`. The harness clicks the actual DOM, verifies the
persisted Task/profile state and restricts browser requests to the fixture origin.
