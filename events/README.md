# Scoped events

A small persistent inbox for immutable events identified by a caller's stable correlation key. `EventStore` owns `iaic_events`. `AssistantEvents` supplies `publish/read/authorize` with injected current scope and source attribution. No broker, outbound notification, model call, UI or second execution loop.

`publish(actor,{key,data})` accepts a non-empty key up to 200 characters and a JSON object up to 8,000 bytes. Trusted source metadata is injected by the host and bounded to 4,000 bytes; canonical hashing supports up to 30 nesting levels. Concurrent/retried identical key/data delivery returns the original event, including its original source, ID, digest and publication time. Changed data conflicts. `read(actor,{key})` requires current scope access. Different owners cannot observe one another's keys. The digest covers canonically ordered data and source; `eventDigest` is available from this module for independent content checks.

ImmediToday labels authenticated incoming events `user-event`. These are user-provided signals, not verified business facts, payment receipts, authority grants or evidence that an external action occurred. A future host adapter publishing trusted business events must authenticate/verify its source and isolate or reserve its key namespace from user publishers. Replaying an existing key never upgrades its source attribution. The internal Assistant can read its event through `my_read_assistant_event`; event publication is available to authenticated external callers through HTTP/MCP, not added to the Assistant's internal tool set.

HTTP: POST `/api/assistant-events` publishes; GET with `?key=...` reads. MCP: `my_publish_assistant_event`, `my_read_assistant_event`. App developers own their webhook authentication adapters and interaction flow. There is no public unauthenticated webhook endpoint.

`EventTriggers` in `../triggers/events.js` registers one-time follow-ups on a scoped key. The source may not exist yet. An already published event also matches; use a fresh unique correlation key to wait for a new event. Matching saves event ID/digest/publication time before existing DeferredTasks creates a Task. No publication means no inference, no Task or allowance debit. Cancellation/retry/receipt recovery use DeferredTasks. `triggerRouter` is a plain map of injected handlers for existing Task and event triggers, not a registry/container framework.

Follow-up task input pins sourceEventKey. When supplied, the internal event read tool can only read that key; current actor permissions still apply. Publication alone does not prove the event's data is true. Read the authoritative domain capability when business facts matter. One published event can match separately authorized follow-ups, each idempotent by its own request key.

Current scope: immutable one-time correlation events and subscriptions, with bounded per-event JSON. Listing/stream cursors, recurring wildcard subscriptions, event expiry/retraction/deletion, ingestion quotas and full retention policies are not implemented. Published events and audit records remain stored. This is a base capability, not a complete event platform or full framework acceptance.

Tests: `test/iaic-events.integration.test.js`; independent package example: `examples/core-events`.
