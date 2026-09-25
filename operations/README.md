# Agent operations read model

Optional `Operations` composes existing module reads and Host signals into a
currently authorized Agent roster, detail and overview. It owns no Task, identity,
model, budget, collaboration or execution state. There is no new database table,
Worker, scheduler or UI. The API is a foundation for the note49 dashboard design;
it is not the completed dashboard or a real monitoring deployment.

Import `operations/service.js` and `operations/capabilities.js`. Public TypeScript
contracts are colocated. `createOperationsCapabilities({operations})` exposes
`operations.agents`, `operations.agent`, `operations.overview` as ordinary read
capabilities with current revalidation. Human UI and authorized AI consumers share
the same semantics. Host catalog discovery still needs its normal permission filter.

## Host ports and visibility

Supply `namespace`, a persistent 32-byte `cursorKey`, `resolveScope`, `authorize`,
`listAgents`, `readAgent` and four `sources`: tasks, signals, models, interactions.
The trusted ports return only authorized, redacted projections for the observer;
never raw Task input, prompts, credentials, Memory or transcripts. The strict source
schemas reject extra fields rather than forward them. This is not a content/DLP
filter: an adapter must also avoid putting secrets inside allowed text fields.

`resolveScope(actor)` returns a canonical binding of observer, application, selected
Tenant/Workspace/Market and current visibility-policy revision as applicable.
Do not use model/request-supplied identity. `authorize(actor,{operation,id,scope})`
must explicitly return true and must apply current account/organization, personal
credential and capability checks. A role label or choosing a frontend view confers
no permission. The same current scope and authorization are checked after reads.

Roster paging happens in the Host on the visible set, before counts/pagination.
Core also rechecks each listed Agent. Scope-bound authenticated/encrypted cursors
hide underlying adapter positions and cannot be reused by a different observer or
visibility revision. Follow nextCursor even if a page is empty after concurrent
revocation. The returned `complete` describes the source's bounded page, not an
assertion that this page contains all Agents. No total cross-tenant count is exposed.

`agents(actor,{limit?,cursor?})` returns descriptors and continuation. Limits are
1..20. `agent(actor,id)` returns current detail. `overview` processes the same page
with at most four concurrent Agent reads and explicitly labels counts
`scope:'returned-page'`; it never calls those counts system-wide totals. A failed or
newly denied Agent detail is omitted and makes the overview incomplete; the other
rows remain available. A failed roster read is an error, never an empty healthy
system. Global scope changes reject the whole response.

## Data and evidence

The persistent Agent identity, its lifecycle, activity and observed runtime health
are distinct fields. Descriptors are Host mappings of current AgentRegistry or
external identities; listing does not create/bind an Agent instance. Each projection
carries an owning module/adapter reference and revision. An internal/external label
is independent of its platform/user-assistant/business role.

Each source returns `{items,complete,observedAt,validUntil,reference}` with at most
50 items. Complete means complete for that declared Agent source/window, not an
arbitrary clipped selection. If an adapter truncates it must return false. These are
bounded detail summaries; full separately paginated Task traces and interactions
are not yet included. Only the Host knows which identities, signals and dependencies
must be covered; do not set complete just because one Worker responded.

Tasks retain their status, waiting reason and independent pending/known/unknown
resultState. Counts retain simultaneous states. Activity is a conservative summary;
stale/incomplete Task coverage is unknown, zero current Tasks with complete coverage
is idle, and waiting for a user is not a runtime error. Descriptors can remain paused
while an already admitted operation still runs.

Signals declare executor/model/connector kind, state, evidence basis and individual
observedAt/validUntil. Missing signals, stale envelopes, future/invalid timestamps,
incomplete coverage and self-reports cannot prove healthy. Healthy requires complete
fresh source coverage with at least one current observed/verified signal and all of
those signals healthy. A current known unavailable/degraded dependency is still shown
with incomplete coverage; `health.complete` remains false. Signal reasons and source
status explain the outcome. reported/observed/verified classify the evidence basis;
Core does not independently attest arbitrary Host adapters or external self-reports.
No health score or universal heartbeat interval is invented.

Model projections distinguish configured profile, Task-bound model, requested model,
actual confirmed model and Provider. Null means unavailable/unknown, not an inferred
value or zero. Multiple rows may represent different Task/call bindings. Reading the
view never switches models or rewrites the Task binding. Provider tokens, platform
allowances and currency aggregates are deliberately outside this first slice.

Interactions retain explicit from/to, type, Task reference, stage and evidence basis.
The Host must authorize disclosed peer references and provide causal identifiers;
temporal proximity never creates an edge. A reported request or received message
is not verified Task or business completion. Both peer details are not automatically
visible just because one interaction is disclosed.

## Failure containment and freshness

Per-source reads have a configurable timeout (default 2s, bound 10ms..30s), propagated
through AbortSignal. Adapters should cancel underlying I/O; a callback that ignores
abort may keep its own work alive, though the projection stops waiting. Read ports
must be side-effect free. Timeout, invalid contract and source-unavailable are public
reason codes; private exception messages are not emitted. Source 403/404 rejects
that Agent detail instead of returning formerly authorized data.

Unavailable detail sources return empty data **together with an explicit incomplete
source status**, never a false known-empty claim. Stale data may be retained with its
source freshness metadata, but does not become current activity/health. Clients must
honor this metadata. Source acquisition is not a cross-module atomic snapshot:
asOf is collection time; each source carries its own observation window/reference.
Cross-source event order or simultaneous consistency is not implied.

## Adoption and limits

Candidate.112 requires no SQL migration. Wire trusted source ports, persist the
cursor key, and exercise current visibility/failure cases before exposing endpoints.
Stop/remove read routes on rollback; existing module state is untouched. Source data
retention, private title policy and current authorization belong to the Host. A
rollout that changes visibility policy should change resolveScope's revision binding.
Candidate.111 support ends 2026-10-09 23:59 UTC on verified successor publication.

Remaining work: a default two-dimensional dashboard, full independently paginated
Task traces/interactions, first-party source adapters, actual external Agent signals,
real model/Provider evidence, model/allowance/cost aggregate views and application
acceptance. The example proves actual TaskStore reads plus explicitly labelled Host
fixtures; it does not claim real Worker/Connector monitoring or a verified peer Review.
