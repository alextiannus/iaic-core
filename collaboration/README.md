# Cross-principal capability authority

For reciprocal reviews independent of task delegation, see [REVIEWS.md](REVIEWS.md).
It composes exact artifact references, trusted peer identity and Workspace-backed
immutable review evidence through the existing Capability interfaces.

`DelegatedCapabilities` composes the existing CapabilityDispatcher with a durable grant. It supplies a first cross-principal authorization building block, not another Agent Runtime or a replacement for same-owner TaskHandoffs.

Required ports: `resolvePrincipal(actor)` returns application/subject identity, `restoreActor(reference)` restores current issuer identity, `authorizeGrant(actor,{action,terms})` enforces issue/read/revoke/execute/continue policy, and `allowInput({issuerActor,delegateActor,terms,capability,input})` enforces domain-specific resource attenuation. They must use current identity and policy data. `PostgresDelegationStore({pool,namespace})` supplies the independent default persistence adapter; initialize its schema before use.

`issue(issuer,{id,delegate,payer,tools,constraints,deadlineAt,maxCalls})` records immutable terms. Payer is an explicit principal reference approved by the host; this module records attribution but does not switch model billing accounts or charge money. Constraints are application-owned data interpreted by the mandatory allowInput port. A grant does not create authority absent from either principal.

`invoke(delegate,{grantId,callId,capability,input},{signal})` checks the live issuer and delegate against the same Capability authorization, checks the domain constraints, and atomically admits an attempt under the grant's call ceiling and deadline. It executes as the delegate through the original dispatcher and its validation, preflight and outcome verifier. It currently supports function capabilities only. Agent capabilities are rejected because their later tools/inference need durable Task and model-gateway binding before they can safely inherit a grant.

The grant lock serializes concurrent admission and revocation. Revocation stops later admissions; it does not undo already admitted effects. A deadline gates admission, and the caller's AbortSignal remains the normal cancellation mechanism. maxCalls counts admitted capability attempts, including attempts that later fail or lose their response. It is not a provider-token, platform-allowance or monetary budget.

Call IDs bind to the grant, and the dispatcher receives a unique effect key persisted with that admission (available as effect_key in the attempt history). Once an attempt is admitted, repeating it is rejected rather than replayed. `read` exposes attempt IDs, input digests and returned/unknown state, not cached result bodies or parent transcripts. A crash before outcome persistence leaves admitted evidence for domain reconciliation. The original capability's effect query must resolve any unknown outcome; do not create another call ID to conceal a retry. Successful return means that the capability's own output and verifier passed, not that a larger parent goal is complete.

`revoke` is issuer-controlled; both participants can read the grant if host policy permits. Unrelated principals cannot read or execute it. Raw store methods are trusted server ports, never direct public tools.

Integration tests use actual PostgreSQL effects with different issuer/executor identities. They prove concurrent call admission bounds, both parties' current permissions, resource restrictions, issuer revocation, isolated reads, and preservation of a committed effect whose response was lost across service reconstruction.

A separate DelegatedTasks adapter now binds these grants and shared platform-unit budgets to persistent AgentRuntime Tasks, with issuer-controlled cancellation; see TASKS.md. DelegationArtifacts supplies explicit input/output sharing and successful Task result projection; Runtime-driven cancellation sweeps reconcile closed grants. CrossPrincipalDelegations now connects parent intents, child scheduling and current result projection; see DELEGATIONS.md. Cancelled-child continuation and partial-work takeover using original operation receipts are exercised; see PROGRESS.md. Full real-model and process-crash collaboration acceptance remains incomplete. The existing TaskHandoffs remains an alternative same-owner adapter. A payer label and a capability-call ceiling do not satisfy Note 30's full collaboration budget acceptance.
