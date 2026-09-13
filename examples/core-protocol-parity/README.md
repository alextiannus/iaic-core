# Shared Capability protocol parity

Run `SUBMISSION_TEST_DATABASE_URL=<isolated-postgresql> node examples/core-protocol-parity/run.mjs`. It creates/drops a random schema and uses one shared CapabilityDispatcher with one independently owned domain table. No model or production endpoint is used.

The same idempotent records.save operation is invoked through ESM toolsFor, the public HTTP SDK, raw HTTP, the official MCP client and the official A2A client. HTTP/SDK/A2A use real loopback HTTP listeners; MCP uses the official linked in-memory protocol transport. This is a protocol-contract fixture, not a claim to test every transport variant.

Checks:

- All five paths return the same persistent record ID/result for the same key and input, with one stored effect.
- Changed input with the same key conflicts; invalid schemas reject without another effect.
- A committed write followed by an injected handler exception remains outcomeUnknown through every path.
- Recovery through another path retains the original key and its idempotent domain receipt, creating no duplicate row. This is supported by this explicitly idempotent implementation, not permission to replay arbitrary unknown writes.
- Revoking the current Capability authorizer denies all paths and creates no new rows.
- HTTP discovery and MCP hints retain the Capability schema/effect/idempotency contract; the A2A card identifies the same Capability.

A2A JSON-RPC uses protocol error envelopes with IAiC status/uncertainty in google.rpc.ErrorInfo data. The official SDK's generic transport error does not always lift those fields into error.metadata; this fixture decodes the existing envelope rather than requiring identical JavaScript error classes or HTTP status codes across protocols. Its initial assumption about the top-level metadata field failed, while the server envelope already contained the expected information. The original failing log is retained separately from the corrected run.

Scope: one function Capability with persistent domain effects. It does not prove UI bindings, all remote identity providers, streaming/push/multi-turn A2A, MCP HTTP authentication or cross-protocol execution of every persistent Agent lifecycle. Existing Agent task examples remain separate evidence. It contributes to Note 30 acceptance condition 3 but does not establish all eight acceptance conditions.
