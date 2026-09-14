# External team tool execution and original receipts

`createDelegatedToolCapabilities({grants})` exposes the existing
`DelegatedCapabilities` service as `collaboration.tools.invoke`, `.read` and
`.revoke`. Add the definitions to an existing dispatcher and expose them through
the application's authenticated SDK, HTTP or MCP surface. The external member
keeps its own runtime and identity; it need not instantiate Core AgentRuntime.

The host issues a bounded function grant through `grants.issue` under its existing
current-principal, resource, tool, deadline and call-budget policy. Grant creation
is not exposed by this adapter. Both issuer and delegate must currently have the
underlying capability authority. Either team member can be issuer or delegate;
there are no built-in/external special privileges.

Invoke input is `{grantId,callId,capability,input}`. Keep both this explicit attempt
ID and the normal outer Capability request key. The original service admits the
attempt once and passes a persisted `effect_key` to the domain capability. Even
identical replay is rejected after admission. A lost wrapper acknowledgement must
not cause another attempt under a new ID. Read returns participant/payer metadata,
grant limits and original calls, without results, model transcripts or arguments.

After a failure or interruption, the other participant can read the original
effect key and query the domain effect using its own authorized capability. It
continues only remaining work. `admitted` or `unknown`, revocation, and a missing
receipt never establish that nothing happened. `returned` records a successful
tool response, not completion of the team's goal. This adapter does not settle
unknown outcomes, share model billing or move an in-flight external process.

Only the issuer can revoke. Revocation blocks later admissions; already admitted
work may still complete. Original receipts remain readable under current grant
read policy. Recorded invoke history refresh returns its original receipt metadata
instead of executing or replaying a cached result body.

**Task-bound grants cannot use direct tool invocation.** They must execute through
the existing DelegatedTasks/AgentRuntime binding, parent checks and accounting.
This closes a previously unguarded direct-function path. Callers using that path
must migrate to `DelegatedTasks.submit`, or request a separate authorized function
grant for external work. The adapter's revoke entry also rejects Task-bound grants;
use the existing Task cancellation service for their cancellation/sweep semantics.
There is no compatibility bypass for this distinction.

PostgreSQL/MCP tests exercise both directions with distinct participants and an
injected response loss after each committed effect. Each covering participant reads
the original receipt; independent database readback verifies the effect executor.
Two directions produce exactly two writes, including rejected replay and revoked
retry. This is deterministic operation-reconciliation evidence, not yet a live
Codex connection, real-model takeover or shared persistent team-task demonstration.
