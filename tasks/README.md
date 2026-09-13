# Persistent task module

Owns task state, persisted calls/events, transitions and its SQL migrations. Consumers provide a PostgreSQL pool and optionally `actorCodec` with `encode(actor) -> [scopeId, subjectId]` and `decode(pair) -> actor`. The default actor has `scopeId` and `subjectId`. Both identity components must be nonempty strings; actor decoding is used by Runtime before current capability authorization.

The two historical storage column names remain `employee_id` and `erp_user` so installed applications retain their existing tasks. Core treats them as opaque identity components; it does not contact ERP. ImmediToday's adapter is `src/ai-native/task-actor.js` outside this package.

Migrations are loaded relative to this module and included in the package. Do not read application-root SQL from Core. Read `store.js` and `migrations/` for task rules; focused checks are `test/iaic-tasks.integration.test.js` and `test/iaic-runtime.integration.test.js` with isolated PostgreSQL. Task version/reconciliation checks remain active; this change does not silently migrate old task code versions.


Tasks can carry an immutable `agent` identity snapshot. The trusted Runtime binding port supplies it, not the user task input. The Agent identity module owns live lifecycle data; Task storage does not join its tables. Legacy tasks remain null rather than receiving invented historical responsibility.

`createTaskReferenceCapability` composes injected current task/artifact read ports into a small read capability. It exposes status, original goal, error and still-accessible artifact references, omitting model transcripts and generated summaries. The application owns identity/authorization and must not return another principal's Task. Source completion triggers consume the same current view; no other module queries Task tables directly.

An optional trusted `handoff` snapshot binds a child to a contract owned by the Handoffs module. TaskStore persists the snapshot/event only; it does not read handoff tables. Runtime rejects execution when a bound child lacks its resolver. Legacy Tasks keep null bindings.

Explicit deterministic result waits are owned here: executor `settle(...,{wait:true})` records a successful read and waiting state in one transaction. `pendingResultWait(version,after)` projects only a latest result_wait event for a successful read. `wakeResultWait` is a trusted Runtime port; it checks identity, version, exact event/call identity, waiting state and absence of uncertain calls under the Task row lock before queuing the Task and recording result_ready/resumed. No caller should access the private task tables to implement polling. Manual/user-input transitions retain their existing behavior; stale wake receipts do not override them.

The optional immutable `delegation` intent uses additive migration012. Executor `delegate` atomically records one intent and external-result wait, rejecting nested/second delegation and unresolved calls. `pendingDelegation(version,after)` and trusted `receiveDelegation(actor,id,{version,delegationId,receipt})` are the observer ports. Receipt delivery checks current owner, wait, version and intent under the row lock, records one event and queues the original Task. The `received` marker is receipt delivery, not a second child lifecycle store. Manual resume cannot bypass a pending intent; cancellation remains available. The Handoffs module owns child contracts.
