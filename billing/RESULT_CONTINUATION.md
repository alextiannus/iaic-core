# Usable results and pending usage

A model response is a proposed action, not a verified business outcome. A trusted
Host can select `policy.pendingUsage: 'continue'` in `meteredModel` when using the
matching `AgentRuntime` and `TokenLedger`. Omitted or `'block'` retains the prior
blocking behavior. This policy is server configuration, never model/user input.

Initialize the ledger before admission. The new `iaic_token_results` table stores
a bounded normalized action separately from billing state, atomically with the
unknown hold. The original call stores payer, Task, turn, model/profile and time.
An available provider reference is retained; absent references are null, not
invented provider evidence. Missing usage stays unknown; available normalized
usage remains in settlement-pending evidence. No zero usage or free reservation
is substituted. All subsequent calls still pass balance and budget admission.

Returned billing metadata includes `resultAvailable`, `usageState`,
`reconciliationRef` (original request ID), `originalTurn` and `providerReference`.
For ordinary confirmed settlement, the charge and entry ID are also available.
A recovered response's usageState reflects ledger state at recovery. Historical
Task events are snapshots, not a live settlement projection.

Runtime checkpoints the response before consuming it. On restart it first reads
uncheckpointed results for the original account/Task/model binding, without
calling the provider or spending another model turn. Call actions use stable
request-based action references and existing durable call receipts. A response
batch remains subject to the original batch policy. Wait/delegation consumption
is recorded atomically with the Task transition. Failed domain verification is a
consumed proposal and can lead to another model turn; successful verification
still must complete the Task. Current identity, Mandate, history permissions,
output bounds and application verifier remain in force during recovery.

`ledger.reconciliationWork(scope, {after, limit})` exposes up to 100 pending items
per page, ordered by request ID, including original attribution, resultAvailable,
reference, timestamp, hold and bounded diagnostic/evidence. Pass the last request
ID as `after`; restart periodic scans from the beginning to discover concurrent
inserts. This is a durable work projection, not another business Task or an
internal scheduler. An authorized Host billing worker fetches authoritative
provider/export evidence and calls `UsageReconciler`. Reconciliation is idempotent
and does not rewrite the business Task. A non-acceptance claim that contradicts a
retained response is rejected. No-result timeouts or errors remain blocking.

Use the standard Runtime. A custom Harness must provide trusted durable
`billingContext.resultReceipts`, persist and recover actions before dispatch,
and serialize Task execution. Never accept receipt IDs from API request bodies
or model text. Low-level ledger methods require trusted Host authorization.

Limits: no real-provider completion or production adoption is established by the
fixtures. A crash before the response/hold transaction commits may leave only an
unresolved reservation; it cannot safely be retried without reconciliation.
Unknown dispatched business calls use the existing external-result recovery,
not automatic replay. Response retention/deletion policy belongs to the Host and
must preserve unresolved calls and active Task recovery. SQL remains in the
Host-owned database; no new service, UI or AI billing agent is required.

Run `test/iaic-usable-result.integration.test.js` with an isolated PostgreSQL URL.
