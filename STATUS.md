# Candidate status and practical limits

Initial extraction revision: `19e80c637e83a16f2197cebacfe729d804ca0e54`.

This standalone repository is public. Its reuse license remains undecided and does not block capability development. Public source availability is not a claim of final framework/application acceptance or support for every environment.

## Usable foundation

The existing modules provide capability contracts/dispatch, a persistent Agent work loop and task/call state, model providers/profiles and per-scope selection, encrypted own-model credentials, platform allowance rules, memory lifecycle operations, selected Skill loading, sourced Knowledge, versioned Workspace artifacts, persistent job identity/configuration, Session timelines, schedules/events/recurring work, Mandates and bounded same-owner handoffs. MCP, HTTP, the remote SDK and ESM expose shared capability contracts.

The configured-job example combines these foundations into scoped work, Session-to-scheduled-task continuity and external Agent access. The other examples demonstrate individual modules or smaller combinations. Methods and resource selectors are injected; there is no dependency on a private application server.

## Boundaries retained

- Currently verified runtime is Node 20. This candidate has not expanded its runtime support claim. PostgreSQL is required by these persistent adapters; alternate database adapters are not supplied.
- Authentication, company sharing, job configuration storage/distribution, business rules and UI belong to applications. Revision comparison inside AgentRegistry is not a distributed configuration transaction.
- Provider Tokens, platform-issued allowance units and actual currency cost are distinct. ProviderCostAccounting now projects pinned rate-card currency estimates from confirmed usage, including BYOK cost attribution, fractional aggregation and optional Task observation integration. Supplier invoice reconciliation and payment/top-up fulfillment still need integration.
- Memory deletion or source invalidation does not globally erase audit, Session text, externally copied content or all derived artifacts. WorkspaceLineage now provides host-captured source dependencies, transitive current-source validation and authorized revision-safe cleanup of invalid current Workspace documents. Runtime history revalidation omits invalid derived bodies. Memory now has optional attributed, revision-bound credibility assessments with separate reviewer authorization; contradicted records leave default retrieval and ordinary correction/forgetting clears old judgments. Automatic semantic assessment, knowledge ingestion, complete lineage capture and complete retention policy are not supplied.
- Schedules may be delayed; an accepted schedule is not a finished task. Closing a Session does not cancel independent work. Multi-party task access and service-principal policy are explicit host choices.
- Existing TaskHandoffs remains bounded and same-owner; a separate DelegatedTasks adapter now supports an explicitly granted cross-principal persistent Task. A separate cross-principal function-capability grant now intersects issuer/delegate authority, preserves payer attribution and atomically bounds call admissions; Agent Task binding is supplied by DelegatedTasks. A separate shared allowance-budget primitive now bounds multiple executors under one payer ledger, retains unknown holds and supports explicitly platform-absorbed overflow. DelegatedTasks now binds grants, payer budgets, model and tool admission to the same Runtime, including reconstruction and issuer cancellation. Exact-reference cross-principal input/output sharing and current successful Task result projection now exist, with mandatory owner sharing policy and source verification. Runtime-driven cancellation sweeps now reconcile revoked/expired unfinished Task grants, including late admission after an earlier scan. A parent-authority adapter now binds child grants to the issuer-owned parent waiting event, preserves its tool/domain ceiling and propagates closure. CrossPrincipalDelegations now connects immutable Runtime intents to child admission, current Artifact results and parent resumption; cancelled-child takeover is verified with deterministic models. Persistent model admission ceilings complement tool and allowance budgets. DelegationProgress now provides current policy-controlled operation receipts for takeover after a partially completed child is interrupted and cancelled. Deterministic integration verifies original-effect lookup after service reconstruction with both successful and lost write responses, without another write. Process-kill collaboration, broader failure takeover, remote orchestration and real-model collaboration acceptance remain incomplete. General cross-principal delegation, full A2A conformance, every MCP protocol feature and arbitrary remote-tool installation are not claimed.
- Results are checked against the host's verifier. Passing schemas and artifact checks does not prove every generated statement is correct.

## Model evidence

The standalone suite uses deterministic models to verify interfaces and persistence. Earlier bounded real-provider samples proved several working paths, but broad application quality remains incomplete. In a recent Session-continuity sample, the model scheduled work and generated/read the correct artifact after service reconstruction, then repeated reads until the sample's six-call limit. The child remained waiting rather than formally finishing. That sample is retained as partial, not passed; this candidate does not hide it or substitute a deterministic result for model-quality acceptance.

Application-specific report quality and business acceptance remain separate work. The framework can be usable as a foundation while Harness/model execution efficiency and broader community extensions continue to improve.

## Foundational development priorities

The design's complete capability map remains the target; headless design does not remove foundational services from that scope. Current modules are usable building blocks, not completion of the entire map.

1. Protocol access: HTTP discovery/execution and a typed remote client are now supplied alongside MCP export. Explicit MCP tool import with paginated discovery is now available. Explicit JSON HTTP API import is now available with host request/schema/credential bindings. A2A 1.0 JSON-RPC now exports structured Capability messages and existing persistent task get/list/cancel bindings through the official SDK. Outbound A2A send/get/cancel/list tools now import approved endpoints with current credentials, shared authorization and bounded requests. OpenApiCatalog now supplies bounded 3.0/3.1 operation discovery and selected scalar-parameter/JSON-body mapping into the existing HTTP importer, with explicit host schemas and policies. Full OpenAPI coverage, streaming/multi-turn support and general external identity provider adapters remain incomplete.
2. Application foundation: allowance accounting, events and workspace persistence exist. Scoped binary object storage now has a default filesystem adapter and shared capabilities. A replaceable account/organization/member directory and shared Capability factory are now supplied, including a default PostgreSQL adapter. A separate subscription/entitlement service now supplies plan snapshots, confirmed-source updates, effective periods and replay receipts. Durable notification delivery now has an independent outbox, channel ports and attempt/reconciliation lifecycle. Monetary invoice/payment/refund defaults now exist with PostgreSQL intents, bounded refund admission and query reconciliation, plus an explicit JSON HTTP payment-provider adapter. Concrete notification/payment provider integrations, monetary usage pricing and automated reconciliation remain incomplete. Applications continue to own business-specific rules and UI.
3. Execution resources: a replaceable Docker code sandbox and released-resource execution capability now exist, with actual container checks. A PostgreSQL execution journal and recovery adapter now inspect surviving containers after an actual worker-process kill, recover original output, stop cancelled/expired containers and preserve missing-container Unknown results without replay. Device execution, remote providers, automatic recovery scheduling and infrastructure-host loss remain incomplete. These modules stay separate from the model loop and business application.
4. Evaluation and evolution: reusable dataset execution, outcome gates, baseline comparison and evidence storage now exist in the evaluation module. Immutable release manifests, evaluation-bound registration, canary selection, stop and rollback selection now exist. Content-verified release resource materialization now exists. Released code now executes through a pinned Docker adapter. Trusted-source observation, fixed-window policy assessment and atomic stop/rollback now exist, including a default metered Task evidence source. Cloud deployment, telemetry collection scheduling and broader production observation still need integration. Repository CI and current runtime version fences are useful parts, not a full general evaluation/release platform. External Codex may act as Platform AI without another mandatory internal Agent.

5. Developer platform: an installed CLI now lists/calls shared HTTP capabilities, scaffolds a local Capability application from an explicit Core archive, and runs versioned PostgreSQL migrations with history checks and transactional batches. A persistent Agent starter now composes identity, Runtime, scoped resources, Session, models and allowance, with a separate-process queued-work test. A default Docker deployment adapter and CLI now deploy an immutable application image, inspect its live health/endpoint and stop it while retaining the original receipt. Real Docker and separate CLI processes verify stable instance reuse and a lost start acknowledgement. Image building, cloud provider adapters, durable desired-state reconciliation, traffic activation/rollback, proactive scheduling/Mandate/handoff template wiring and broader simulator tooling remain incomplete.

These items are capability work. Broader security hardening and final acceptance follow usable foundational implementations, without changing the design's concepts or adding mandatory role classes.


## Prepared deployment recovery

The optional RecoverableDockerDeployment composes Docker preparation with a separate PostgreSQL activation journal. It can continue an original prepared container after the creator process dies, while serializing concurrent start admissions and retaining uncertainty after an admitted but unconfirmed start. Actual SIGKILL tests cover both boundaries; Docker identity and no-restart checks cover accepted response loss, stopped workloads and removed originals. An admission is never silently reset. This adds a usable deployment recovery path, not complete desired-state orchestration, cloud/traffic activation or all crash-window recovery.


## Actual-model composition baseline

The opt-in core-real-composition example uses the public Runtime, Skill/Memory discovery, Workspace, metered provider and independent evaluation ports with synthetic source records. Its first DeepSeek V4 Flash run at 87cafa4 scored 0/3: 30 model responses included 18 rejected multiple-call responses, and all Tasks stopped at their turn limits. A fixture omission of Memory listing also prevented key discovery. The harness now supplies listing and grader v2 accepts the same preference content through either read path; this changed harness is not yet real-model validated. No successful acceptance is inferred from repository CI. That baseline motivated the bounded multi-call capability described below; the failed evidence remains retained.


## Bounded multi-call execution

AgentRuntime now offers explicit maxBatchCalls (default 1, at most 8). A model batch is persisted before sequential dispatch, and each original call is bound to its batch position atomically. Current authorization, tool budgets and result verification remain per action. Unknown calls pause later steps; failed steps abandon the unexecuted remainder. PostgreSQL integration verifies reconstruction/reconciliation, preparation interruption, scope rejection and cancellation. The opt-in real composition fixture now enables a bound of four; its new real-model result must be recorded separately from the retained 0/3 baseline. See agent/BATCHES.md for adapter requirements and limits.


At release source 73eb47a69e395bc4215808ece75e61477aa949dd (candidate.30), the actual DeepSeek V4 Flash composition re-evaluation passed all three synthetic cases using grader v2, Memory discovery and maxBatchCalls=4. It used 17 model responses, 5 durable batches and 24 tool calls. Actual usage was 51,054 input plus 13,207 output Tokens; fixture platform allowance consumption was 64,261 units. Artifact contents, required source/Skill/Memory observations and settled billing all passed. The prior 0/3 run is retained separately. Changed configuration/grading assumptions prevent a single-variable comparison; these authored samples are not an independently curated blind holdout and do not establish all eight Core acceptance conditions. Evidence run: 051d3007-926a-486c-ae29-95ddd63c7e51.


Batch adapter compatibility now has an explicit executor interface and a pre-dispatch persisted-receipt check. Enabling batches with a legacy executor fails before model work and releases the acquired session. Dropped receipt metadata pauses before any external action. This verifies compatibility with the default PostgreSQL adapter and rejects accidental legacy reuse; it does not certify arbitrary third-party persistence implementations. No new actual-model evaluation was run for this interface check.


## Organization-owned resource composition

DirectoryResourceScopes now supplies an optional current-directory and resource-policy resolver for existing Memory/Workspace modules. Operations pass read/write intent and their operation name to the resolver; same-organization members share original revisions while personal and different-organization partitions stay separate. Current revocation and read-only policy are exercised against real PostgreSQL defaults. The module imports no account or resource storage implementation, preserves legacy one-argument resolvers, and does not migrate private data, add a UI, or imply shared Task ownership or global erasure. See resources/README.md.


## Trusted observation collection

ReleaseObservation now discovers bounded trusted source references and assesses one pinned window only when collection is complete. ReleaseMonitor composes collection and optional host-enabled protection as an ordinary capability, retaining current authorization, manifest/revision checks and the original release evidence. Independent installed Docker release execution exercises the collection-to-rollback operation. It adds no scheduler: production source discovery, recurring monitoring Task wiring and uncertain cycle receipt reconciliation remain incomplete. This is a foundation increment, not completion of Note 30 acceptance.


## Scheduled Agent task composition

createAgentTaskSchedules now connects existing recurring/deferred services to shared Agent dispatch and scoped original Task receipt lookup with immutable input comparison and current schema/authorization checks. A separately installed example runs a scheduled monitoring Task across two worker processes after losing the successful admission response, then verifies one original Task, one monitor call and one rollback. This integration found and fixed ReleaseMonitor's missing history permission revalidator; historical evidence remains readable under current permission after the candidate stops. These are deterministic fixtures and orderly process replacement, not continuous production monitoring, a SIGKILL monitoring proof or full Note 30 acceptance. Production source discovery and uncertain protection receipt reconciliation remain incomplete.


## Signed external event input

HmacEventIngress now authenticates a bounded IAiC HMAC envelope using current host endpoint/key/scope resolution, raw bytes and freshness checks, then reuses immutable scoped EventStore publication. An optional Node HTTP handler and reserved ordinary-publisher namespace are supplied. Existing exact-key EventTriggers wake DeferredTasks without inference before publication; PostgreSQL integration checks one original follow-up Task after duplicate signed delivery. This is a generic documented profile, not vendor-specific webhook support, event streaming/retention or production deployment evidence. Signed signal content does not confer authority or establish business truth.


## Versioned Knowledge ingestion

KnowledgeIngestion and PostgresIngestedKnowledgeStore now import authorized, versioned plain text/Markdown snapshots into bounded UTF-8 chunks through existing Catalog interfaces. Atomic source replacement removes old surplus parts; withdrawal clears all current content/metadata and retains a revision tombstone. Current source, policy and ingestion revision remain visible in chunk provenance, and original references invalidate after correction/withdrawal. Independent installation exercises large-document import and existing retrieval. This does not add embeddings, scalable search, format extraction/crawling, global erasure or model-quality acceptance. Separate reads spanning concurrent updates still require reference/source-revision checks.


Knowledge ingestion context integration now verifies current body removal and derived Workspace invalidation after withdrawal. A reproduced adapter-replacement failure was fixed: syntactically valid legacy Catalog IDs now return not-found from the ingested store rather than invalid-input, allowing normal unavailable-reference projection. Malformed IDs still reject. Historical audit bodies are retained; no global-erasure claim is made.


## Shared model capacity

PostgresModelCapacity and capacityModel now enforce a host-configured concurrency pool across workers, preserving original Task-turn admission and uncertain reservations through process failure. A SIGKILL fixture verifies no automatic slot reclamation; current-authorized trusted terminal evidence releases the original slot. Real ledger integration proves busy preflight causes no provider call or platform debit, and an installed Runtime example combines capacity, metering and cost accounting. The module does not implement provider RPM/TPM, waiting fairness, routing/fallback, automatic unknown-release assumptions or real-provider liveness reconciliation. Full Note 30 acceptance remains incomplete.


Model capacity now recognizes trusted provider-completed validation errors. A reproduced Runtime correction failure was fixed: a completed response with an invalid action releases its slot so the next model turn can correct it, while both confirmed usages remain billed and transport uncertainty still retains capacity. This is deterministic protocol/Runtime integration, not a new actual-model quality claim.


## Default HTTP notification channel

createHttpNotificationChannel now binds approved JSON HTTP providers to existing outbox send/query ports using the shared transport. Stable-key and terminal-receipt checks preserve unknown results after response loss or mismatched evidence. Loopback HTTP/PostgreSQL integration reconciles a lost acknowledgement without another send and checks current credentials/permission. The installed notification example consumes the adapter with a fixture transport. No external messages, vendor registration, recipient UI or notification policy product were created; vendor-specific delivery semantics and full Note 30 acceptance remain incomplete.


## Cross-entry Capability parity evidence

The installed core-protocol-parity fixture now exercises one persistent idempotent domain capability through ESM, HTTP SDK, raw HTTP, official MCP and official A2A clients. It verifies one original result/effect, conflicting/invalid input, post-commit uncertainty, recovery through another entry and current permission revocation. HTTP/A2A use loopback servers; MCP uses official in-memory protocol transport. A corrected test decoder reads A2A ErrorInfo metadata from its actual JSON-RPC envelope; no server bug is inferred from that initial fixture assumption. This contributes common-contract evidence, not full UI/transport/Agent-lifecycle or Note 30 acceptance.

## Explicit pre-task model routing

AssistantModelRouting now composes AssistantModels with current authorized ordered profiles and host availability. New Tasks choose an explicitly permitted available model within the selected credential mode; the actual model identity is persisted by the existing Runtime. Reconstructed Tasks retain that identity, and current route/catalog revocation stops later calls. Each original gateway owns its metering. No provider error, exhausted allowance or unknown request switches models/accounts. The installed PostgreSQL example verifies old/new Task selection across service reconstruction. Availability and provider outputs are deterministic fixtures; automatic health discovery, RPM/TPM/fair queues and post-dispatch failover are not supplied. See assistants/ROUTING.md.

## Expired current-payload retention

RetentionSweep now composes bounded, current-authorized expiry cleanup for default Memory, document Knowledge and ingested Knowledge stores. Storage mutation rechecks database-time expiry and original revision; Memory clears statement/source/review fields, Knowledge clears current metadata/body, and ingested source cleanup atomically removes all chunks. Revision tombstones prevent stale resurrection. Concurrent extension/sweeps and injected chunk-delete failure are verified on PostgreSQL. This is opt-in logical current-row cleanup, not Task/Session/audit/backup erasure, complete retention policy or automatic derived-artifact deletion. See resources/RETENTION.md.

## Shared fixed-minute model admission rates

PostgresModelRateLimits and rateLimitedModel now supply shared request-count and provider-Token admission budgets, preserving original Task-turn receipts. Confirmed usage replaces reservations; explicit non-dispatch removes consumption; unknown responses retain reservations in their original admission window. The existing capacity and ledger retain their separate uncertainty rules. Rejected admission invokes no provider and leaves no platform debit. PostgreSQL tests cover concurrent admission, immutable reconciliation, window rollover fixtures, over-bound usage and composed metering; the installed cost example now includes rates. This is fixed-minute local admission accounting, not every vendor's rolling limits, fair queuing, automatic health/header synchronization or full Note30 acceptance. See agent/RATES.md.

## Generated Agent gateway composition

The independent Agent template now accepts optional AssistantModelRouting policy/availability ports while retaining default AssistantModels behavior. Its existing provider factory composes rate limits and capacity before original metering. A generated-and-installed app verifies backup identity persistence across service reconstruction, actual settled rate/capacity/allowance state, current route revocation and new-task primary selection. This bridges existing Core modules into the starter; it does not add another gateway or default routing/quota/retention policy. Public guides now link these modules and avoid outdated fixed example counts.

## Original observation protection reconciliation

ReleaseObservation.protectionResult and the optional read-only observation.protection_result Capability now recover the exact original assessment/channel-revision rollback event. ReleaseMonitor.recoverProtection adds its history/channel checks. Current authorization and immutable evidence bindings apply, but historical receipts remain readable after policy aging or later channel changes. Missing receipts are unknown, not permission to replay. PostgreSQL tests inject lost post-commit acknowledgement and verify one original rollback; the installed Docker release example queries the same event. This supplies original-operation lookup, not a durable monitor-cycle journal, automatic recovery worker, real process-kill proof or cloud traffic rollback.

## Persistent monitoring-cycle bindings

PostgresMonitorCycles and PersistentReleaseMonitor now retain each owner-scoped cycle's original collection/assessment, target revision and protection decision before execution, with immutable final results. Shared run/recover capabilities never rerun an admitted cycle. Actual worker SIGKILL after rollback commit recovers via the cycle key and original event without another protective action; the installed Docker release example uses the same module. Started cycles without snapshots and prepared cycles without confirmed rollback remain unknown, with no automatic takeover/worker. This is a durable binding and original-result recovery foundation, not all monitoring crash boundaries or full Note30 acceptance.

## Browser device execution foundation

BrowserDevices, PostgresDeviceOperations and PuppeteerPageDevice now provide current-authorized DOM observation, screenshot references and bounded navigation/input/click/key/scroll actions through shared capabilities. Original operation keys/digests prevent replay; unresolved work blocks further action admission on the same device. The host owns browser isolation, network/session policy, screenshot storage and lifetime. Actual local Chrome/HTTP evidence verifies commands, PNG capture and independent effects after injected response loss. Default CI uses PostgreSQL/injected-driver checks; the real-browser example is opt-in. This does not provide native desktop/mobile drivers, atomic visual targeting, full browser sandboxing or real-model device acceptance.

## Device original-source reconciliation

DeviceOperationReconciliation now confirms an original pending browser action only from a current-authorized host source matching the original owner/device/key/digest and proving driver termination. Terminal evidence is immutable; reconciliation never touches the browser. Confirmed original receipt clears the admission block while old-key reuse still cannot repeat the command. PostgreSQL checks cover incomplete/mismatched evidence and revocation during lookup; the opt-in real Chrome example reconciles a bound fixture driver receipt and continues without another form submission. This is a trusted reconciliation boundary, not generic durable browser-command evidence discovery or full device acceptance.

## Delegated worker process interruption

An actual SIGKILL fixture now interrupts a delegated Runtime worker after its PostgreSQL effect and artifact commit but before the tool returns. Reconstructed execution preserves the unknown original call; issuer cancellation and current progress sharing let the parent query that exact effect and finish through its outcome verifier without another write. The original grant retains its admitted attempt, one model admission and two fixture platform units; no unconfirmed call is relabelled returned. This strengthens the existing takeover path without changing production modules. Models remain deterministic, the parent does not execute additional remaining writes, and broader real-model collaboration acceptance remains incomplete.

## Reusable local simulation adapters

LocalSimulation and createScriptedModel now supply a headless developer simulator through the existing Capability and model ports. Scoped JSON reducers, stable operation receipts and explicit lost-response injection compose with the persistent Runtime; scripts select durable model turns instead of a local cursor. The installed core-simulation example pauses after a simulated committed write, reconstructs Runtime/model while retaining the local world, reconciles the original operation and verifies one effect. Initial fixture input used a scalar outside the Agent action contract and was corrected to an object; that failed evidence is retained. This adds development capability, not a new executor, durable remote simulation, timing virtualization or real-model acceptance.

## Agent template execution limits and continuity evaluation

The Agent template now exposes explicit positive integer Runtime limits without exposing replacement engine/policy ports through that object. Shared Assistant instructions now defer to the Runtime's configured batch bound instead of contradicting enabled batches with an unconditional single-call instruction. The opt-in core-real-continuity harness uses the public template, a persistent configured identity, scoped resources and closed Session, then executes the original Task in a new worker process. Its deterministic preflight passed; actual-model results are recorded separately after freezing a committed source. This is not full lifecycle/real-model acceptance by itself.

The first actual continuity run at 8382009 failed (b19b49d9-4b0f-4bd7-89a9-f9a887e10d3e): six provider responses, a waiting Task, incorrect ordering and no artifact readback. Identity/model and closed-Session worker continuity were retained, but the default template omitted Memory listing from its tool scope, leaving the model guessing keys. The template now exposes existing Memory discovery, and its generated deterministic provider exercises that entry instead of relying on a known key. The continuity grader accepts the exact preference through either read or list; no execution limits or expected contents changed. This is a changed configuration/grader, not an untouched holdout re-test. Original failed evidence remains preserved.

## Cursor event subscriptions

EventStore now supplies scoped committed-order cursor pages, with publisher transactions serializing sequence allocation within each scope. PostgresEventSubscriptions and EventSubscriptions retain independent literal-prefix consumer checkpoints with current authorization, bounded acknowledgement and monotonic concurrency checks. Shared subscribe/read/acknowledge capabilities support normal dispatcher surfaces and current history revalidation. PostgreSQL checks cover overlapping publications, legacy event backfill, restart redelivery, independent scopes and current revocation; the installed events example combines signed ingress and cursor consumption. All feed publishers must use the upgraded coordinated adapter before cursor consumption; older/direct SQL writers are not covered. No automatic worker, business-effect deduplication, exclusive lease, retention or streaming broker is implied.

## Event-driven persistent Agent admission

EventTaskSubscriptions now composes cursor feeds with existing DeferredTasks and Agent Runtime admission. Original event ID/digest/subscription bindings select a reserved stable queue key; recovery reuses the original authorized plan before advancing the consumer checkpoint. The independent installed core-event-agent example verifies a lost queue acknowledgement, reconstruction, one original Task and outcome verification; PostgreSQL checks also cover concurrent consumers, lost checkpoint acknowledgement and revocation after enqueue. Empty feeds create no Tasks or inference. This supplies event-to-work composition, not another queue/worker, automatic business-effect deduplication, process-kill or real-model subscription acceptance.

## Release-bound persistent Agent execution

ReleaseBoundAgentIdentity now decorates existing Runtime identity hooks with a saved manifest reference and current release/version checks. Runtime supplies its version at identity admission; existing hooks may ignore that additional field. Original Agent pause/authority remains effective, channel changes do not rewrite old bindings, and stopping a candidate while its model response is returning prevents the proposed tool action. PostgreSQL integration uses distinct capability/regression fixture runs; the installed release example connects observation rollback to a blocked candidate Agent and newly admitted fallback Agent. This supplies release-to-Agent enforcement, not automatic immutable implementation loading, multi-version worker routing, live cloud rollout or new actual-model acceptance.

## In-memory evaluated release resources

ReleaseResources.read now supplies digest-checked, independently copied resource bytes without temporary files. It snapshots the original binding and manifest descriptors before asynchronous reads and checks current release status before returning. Existing filesystem materialization shares this validation path and retains post-write checks and cleanup. The installed release/Agent example now builds both candidate and fallback prompts from checked bytes. Host decoding and actual configuration assembly remain explicit; this does not automatically load model weights, Tools or Skills or establish full evolution acceptance.

## Shared persistent Task lifecycle controls

createTaskControlCapabilities now packages current result/state reads, cancel, resume and user clarification against the existing Runtime ports. Default projections omit internal identity, inputs and transcripts; the Agent starter consumes the shared module while preserving its prior row projection. History refresh never repeats transitions. A2A accepts an optional metadata-only state binding before cancellation, avoiding an unnecessary historical-source read while retaining endpoint/Task authorization. The installed core-agent-surfaces example submits one Task across ESM/HTTP SDK/raw HTTP/MCP/A2A, supplies input through MCP, reconstructs Runtime, verifies one shared result and cancels another Task after source revocation. Models are deterministic and no UI or process-kill coverage is implied; transition receipt reconciliation and full framework acceptance remain separate requirements.

## Original resume and clarification receipts

TaskStore migration015 now atomically binds optional stable resume/input request keys to original transition snapshots alongside Task state and input events. AgentRuntime exposes current-authorized original receipt lookup and avoids re-executing an already committed request. createTaskControlCapabilities enables this with receipts:true; the Agent starter now opts in. The cross-entry installed example reconciles a lost MCP clarification acknowledgement through SDK receipt lookup and an identical HTTP request. PostgreSQL integration also kills an actual worker after commit and verifies reconstruction, immutable input/action binding, no duplicate clarification in a later wait, concurrency and atomic rollback on receipt failure. Cancellation/child propagation remains outside this new receipt contract; no new actual-model result or full reliability acceptance is implied.

## Actual-model clarification harness

The opt-in continuity harness now includes an authored clarification scenario: missing user choices, explicit overriding input, lost input acknowledgement, original receipt lookup and a second worker continuing the same Task after the Session is closed. Frozen expected results and initial trace are retained separately; deterministic preflight passes the 15 scenario checks. Actual-model evidence is recorded after freezing a committed source. This extends acceptance tooling, not production Runtime behavior or independent holdout/full acceptance claims.

The first actual clarification run at b6ce3df (3b669633-648c-4b2f-82bf-2618c8256fc6) correctly asked for input and produced the expected artifact after reconstruction, but did not finish. It repeated creation with expectedRevision:0 after a successful write, and the rejected write became unknown, preventing readback. The default Workspace adapter now supplies a read-only revision preflight through the existing Capability hook; known stale writes become correctable pre-execution feedback. Races after preflight still remain uncertain. A deterministic Runtime reproduction verifies one stored revision, a failed duplicate call, subsequent readback and completion. Actual-model follow-up evidence remains separate; the original failure is retained unchanged.

## Current-authorized persistent Task pagination

TaskListing and createTaskListCapability now provide bounded current-authorized Task discovery over the TaskStore page port. Keyset positions preserve timestamp microseconds and UUID ties; authenticated encrypted cursors bind owner/filters and survive reconstruction with the host's persistent key. Denied/missing candidates are omitted, empty pages can still continue, and non-permission failures propagate. The Agent starter can opt in with taskCursorKey; the installed surface example resumes an HTTP SDK page via official A2A. PostgreSQL tests enumerate 75 same-time Tasks, cover reconstruction/filtering/current revocation and cursor isolation. Initial fixtures used a future timestamp for supposedly older rows and a partial SDK enum request; both fixtures were corrected without changing the pagination contract. This is live discovery, not a snapshot, total-count service, event delivery guarantee or new actual-model acceptance.

## Browser UI binding evidence and current Agent questions

An opt-in real Chrome fixture now exercises a minimal application page using the unmodified public HTTP SDK: stable submission, page closure, Task discovery, clarification, Runtime reconstruction, verified result equality, cancellation and current revocation. It exposed two integration gaps: browser fetch requires its global receiver, now retained by the default client transport; and default Task get lacked the actual pending question, now exposed as current-authorized inputRequest with its original event reference. Deterministic module checks cover the receiver and question lifecycle/source revocation; screenshots and installed-browser evidence are recorded separately. The fixture owns its UI and auth, creates one independently verified PostgreSQL record, and uses no real model or production service. This adds actual UI binding evidence, not all UI states, browser engines or full Note30 acceptance.

## Bounded historical result context

ContextAssembler offers explicit overflow:'omit-old-results' for display-only elision of older successful result bodies after current authorization and refresh. Goals, clarification/event order, operation identities/status, failures/unknowns and the most recent settled result remain intact; irreducible overflow still stops explicitly. Durable history and ordinary authorized result access remain complete. The Agent template opts in. A PostgreSQL Runtime fixture verifies waiting, reconstruction, clarification and successful continuation without repeated reads. This is a foundational context-management option, not semantic summarization, arbitrary-length working memory or real-model evidence. See context/README.md.

## Authored actual-model transfer failure and invocation guidance

A frozen two-goal authored transfer set (source 273a676, run e5332536-dce4-4a43-ab6b-893da3778e30) failed 0/2 with the configured deepseek-v4-flash provider: both Tasks reached their turn limit without an artifact. With explicit single-call policy, 18 of 20 responses contained multiple calls and were rejected; each Task completed only one read. Runtime's permissive four-call guidance was still visible even though the provider imposed a stricter limit. The provider now supplies a final explicit single-action instruction when parallelToolCalls:false, matching its existing wire and admission rules. Targeted transport checks verify this across both protocols without mutating caller messages. This is a configuration-consistency fix; no actual-model improvement is claimed without separate evidence. The failed corpus is no longer untouched, and the policy/environment differs from earlier runs.

## Fixed-policy regression and bounded-batch comparison

Two further actual-model runs used the unchanged candidate.63 source 68ecdcba and the same authored transfer dataset, grader and 10-turn/8-call budgets. Single-call regression 9118d9d3-3fae-4f4e-8426-843eb39b69d5 still failed 0/2: invalid multiple-call responses fell from 18 to 10, but literal memory searches for "presentation" returned no content matches and no artifacts were completed. It consumed 55,043 input + 7,184 output = 62,227 Provider Tokens.

Bounded-batch comparison 3ae24ca9-b8d5-4528-9ff7-82cc9f5771b4 changed only parallelToolCalls to true (Runtime ceiling four). It also failed 0/2, with zero invalid multiple-call responses and 16 total tool attempts. The first case initially wrote correct data, then added unrequested fields and exhausted its budget; its wording about "all reasons" is potentially ambiguous and limits attribution to model failure. The second wrote and read back the exact expected artifact, but missed the required memory and did not complete. Both reached waiting/limit after an unconfigured final control selection. Usage: 42,849 input + 13,095 output = 55,944 Provider Tokens. Independent grading remains failed despite partial artifact correctness.

All three runs are retained; these are small development/configuration comparisons, not independent holdouts, statistical causal estimates, or full Core acceptance. Both new runs settled their separate fixture allowance ledger completely (1:1 test rule, no production-user charge). No further prompt/budget tuning or repeated run was used to replace these failures. Current evidence points to memory discovery and reliable task completion as remaining practical concerns; it does not justify declaring the model or framework fully accepted.

## Memory name discovery

Default Memory list queries now match literal case-insensitive substrings in both memory_key and content. This makes named preferences discoverable when their bodies omit the label used in the query; explicit searchIn:'content' preserves the former content-only lookup. Shared Tool schemas/descriptions and history input projections expose the same option. PostgreSQL integration verifies name/content discovery, literal metacharacters, current scope/status/forgetting and historical refresh through the shared Capability. This is a deliberate query-default expansion, with no result-shape/schema migration, semantic search or actual-model completion claim.

## Actionable application outcome feedback

AgentRuntime and Assistant task composition accept a trusted boolean verdict or {verified,feedback} from the application verifier. Bounded feedback is persisted with the verification event and re-enters current context after waiting/reconstruction; invalid result shapes receive a generic schema correction without calling the domain verifier. Invalid verdict objects fail explicitly rather than truthily completing a Task. PostgreSQL evidence exercises schema rejection, domain rejection, user-input wait, Runtime reconstruction, correction and a fresh successful application check. This adds reusable outcome-feedback capability, not a changed acceptance rubric, unlimited retries or actual-model success evidence.

## Remaining-budget context and effective batch bounds

Runtime now communicates durable remaining tool attempts/model turns before every inference and caps both batch guidance and provider admission at the current remaining attempts. Completion-only context explicitly reports zero remaining tool calls while preserving the existing final finish/wait opportunity. Counts survive waiting and Runtime reconstruction; no budget, authority or retry policy is expanded. PostgreSQL verification covers 2-to-1-to-0 remaining calls and final verified completion. This closes a planning-information gap, not a diagnosis of the exact unconfigured control names lost in earlier traces or proof of improved actual-model completion.

## Actual-model control protocol isolation

A two-request synthetic protocol probe on candidate.66 source 0cb0b9c confirmed that the configured deepseek-v4-flash Chat Completions endpoint returns the exact declared iaic_finish and iaic_wait names and that the shared adapter parses them correctly. Both requests offered only the control tools, used the default automatic tool choice and a one-action bound, and passed their fixed expected action checks. Usage was 867 input + 157 output = 1,024 Provider Tokens; this direct development probe did not use a platform allowance ledger.

This rules out an unconditional inability to emit/parse the basic controls in that narrow setting; it does not identify the unknown selected names lost from prior long-task traces or prove reliable completion with full history. No permissive function-name rewriting, parser relaxation, production change or new runtime release follows from this probe. Prior full-task failures remain open.

## Application-verified direct outcomes

Shared Agent task composition no longer forces an otherwise verifiable task to perform a Tool call before reaching the host outcome verifier. Output, required-artifact and exact reference/current-access checks remain; applications retain their own source/effect evidence requirements. A PostgreSQL fixture submits an incorrect direct arithmetic answer, receives trusted rejection, corrects it and succeeds only after the application verifies it, with zero tool calls. A forged artifact still fails before the verifier. This removes a fixed workflow assumption, not a completion check or the existing actual-model grading requirements.

## Actual lasting-preference workflow evidence

The new opt-in continuity memory-update scenario freezes an explicit once-only preference change, Skill/Knowledge/Session composition and artifact readback before inference. It uses preselected standard 20-turn/30-call limits, not changed budgets for earlier failed cases. Deterministic preflight passed all 12 checks; the independently installed package passed all 41 default examples and exact-source CI.

Actual deepseek-v4-flash run 181710df-7082-4e6d-a80c-8876dec9648b at source 5a9ed0d failed: the separate worker retained identity/model after Session closure, read the Skill/Knowledge/Memory, and produced/read back the exact expected artifact. However, it performed 13 successful identical memory updates (revision 1 through 14) instead of one. After 30 tool attempts, the final completion invocation had unknown usage and the Task correctly remained waiting/usage_reconciliation. Confirmed usage was 111,929 input + 17,876 output = 129,805 Provider Tokens; one further invocation has unknown usage. The isolated fixture ledger retained a 100,000-unit unknown reservation rather than refunding it. These platform test units are not additional confirmed Provider Tokens or production-user charges.

The scenario's temporary PostgreSQL schema was cleaned up by the harness; the original pending-request snapshot and all events/calls are retained in private evidence. No provider reconciliation was established or claimed. Correct artifact content does not override the repeated-update or unsettled-usage failures. No budget increase or repeat was used to replace this outcome; persistent progress and repeated-mutation behavior remain practical gaps.

## Host-defined per-tool Task ceilings

Agent definitions and shared Agent composition now accept an optional immutable
toolCallLimits map. Runtime counts durable prepared attempts per Tool, exposes
remaining counts, removes exhausted Tools from discovery and blocks new single or
pending-batch attempts before preparation. Failed and reconciled attempts remain
spent after reconstruction; unknown effects retain their existing pause. The Agent
starter forwards this application-owned configuration. Defaults are unchanged.

This lets applications express constraints such as one memory-write attempt per
Task without hardcoding memory behavior into Runtime. It does not automatically
interpret user intent, share a limit across child/scheduled Tasks, deduplicate
business effects or prove that the previous actual-model workflow now succeeds.
The recorded 13-update failure and unknown provider usage remain open. Focused
PostgreSQL checks cover returned/unknown/rejected original actions, batch closure,
restart, revocation, independent effect counts and server enforcement despite a
model ignoring discovery. An initial test assertion assumed every feedback event
had an error string; it was corrected to permit user-question feedback.

## Workspace-backed persistent Task plans

TaskPlans and shared plan read/update Capabilities now provide bounded, editable
steps and progress over the existing Workspace port. Current Task access,
Workspace scope and version checks apply; executing Agent calls are confined to
their own Task, and terminal Task updates reject. ContextAssembler's optional
planProvider loads the current plan on each inference. Shared Agent composition
and the opt-in Agent starter expose the same module. There is no new store,
executor, fixed workflow or mandatory extra model step.

Plans are claims and working materials, not business facts, permission or outcome
verification. The independent example deliberately rejects an all-done plan
without effects, then persists progress, reconstructs Runtime and verifies one
original business write with readback. PostgreSQL checks also exercise CAS races,
stale updates, current revocation, scoped Task access and refreshed historical
plan content. This adds a planning foundation, not a claim that the prior real
model's repeated mutations or long-task completion failures are resolved.

## Actual planning and once-only memory workflow

The explicit planning variant at source 8e552ae (run
f1686c5e-dc6e-499f-b121-4c2cffa4add1) passed all 13 frozen checks with the configured
deepseek-v4-flash model. It enables the public Task Plan module and a one-attempt
memory-write ceiling for the goal's explicitly once-only update; the goal also
requests a persisted working plan. The existing 20-turn/30-call, four-call batch,
60-second inference and five-minute Task limits remain. Other modes are unchanged.

After the original Session/app closed, the separate worker retained identity and
model, used Skill/Knowledge/Memory/Session resources, updated memory once to
revision 2, persisted plan revision 4, wrote/read the exact expected artifact and
formally finished. Usage fully settled: 136,319 input + 13,092 output = 149,411
Provider Tokens, with no unknown reservation. Equal fixture allowance units use
the explicit 1:1 test policy; they are not provider pricing or a production-user
debit. Source CI 34776699068 and 42 independently installed default examples passed;
the installed deterministic scenario preflight passed its 13 checks as well.

The actual run still used 18 responses and 26 tool attempts, including six plan
reads and five knowledge searches. Two invalid responses (mixed batch controls and
an unconfigured name) were rejected before valid completion. Their usage is
included, not discarded. This is a usable authored composition case, not an
independent holdout, statistical attribution to either new module, mid-task
process-kill test or full framework acceptance. Earlier failures and their unknown
usage remain unchanged. No further paid retry or budget increase was performed.
Only opt-in evaluation configuration and evidence changed this turn; the latest
runtime prerelease remains candidate.69. The initial source preflight omitted its
fixture URL and failed before inference; the corrected configuration and original
failure were retained separately.

## Optional scheduled work in the Agent starter

The Agent application starter now composes existing DeferredTasks and shared
scheduling/control Capabilities when supplied a trusted scheduling.restoreActor
port. It verifies current authorization and the restored original owner scope.
app.start starts Runtime and scheduler; close drains scheduling before Runtime
shutdown. The generated server consumes that lifecycle. Future work uses current
model selection and existing allowance rules, while Session linkage and stable
schedule/Task receipts remain in their original modules.

DeferredTaskStore now optionally filters claims by application and/or job before
locking a row. The starter filters by its job ID, avoiding accidental consumption
of another job's intents. Existing unfiltered workers retain their old behavior
and must be configured consistently when sharing a table. This is claim routing,
not a replacement for authorization or Runtime executor/version ownership.

The installed starter check exercises schedule receipt reuse, application
reconstruction, closed-Session result linkage, current model selection, one
verified Task, allowance charging, future cancellation, wrong-owner restoration
and clean worker shutdown. Separate PostgreSQL checks verify disjoint claim
scopes without changing foreign intents. This is one-time scheduling composition,
not new recurring/event orchestration, production deployment or real-model proof.

## Event work composition in the Agent starter

The optional eventWork configuration now wires existing scoped EventStore,
subscription checkpoints and EventTaskSubscriptions into the Agent starter's
durable queue. Hosts supply trusted source attribution and bounded Task building,
drive subscription consumption from their own listener/worker, and explicitly
enable the source-event read Tool. app.start continues to run deferred admission
and Runtime; it is not a new subscription scanner or webhook endpoint.

The installed generated-app check publishes an event, loses the successful queue
acknowledgement, reconstructs the application, reuses the original Task input and
completes one source-verified Task. Empty/repeated consumption causes no inference;
untrusted payload Tool names do not replace host scope; current revocation leaves
the next cursor unacknowledged. Queueing remains distinct from business outcome.
No new execution engine, remote broker, actual-model run or production deployment
is introduced by this application composition.

## Shared current execution policy decisions

ExecutionPolicy now defines optional strict allow/deny decisions with a rule
revision, reason and optional host risk label, plus a required recording port.
Dispatcher checks admission/function execution; Runtime checks direct admission
and current Agent execution around its existing lifecycle boundaries. The Agent
starter forwards the same policy. Base permissions still run independently and
cannot be widened. Invalid verdicts or missing recording receipts block execution.

PostgreSQL integration retains actor/Task/call-linked decisions, changes a switch
while a model response is pending, verifies no subsequent write, reconstructs and
resumes the original Task under current rules, and checks HTTP denial. Policy
records do not automatically copy input payloads or count as business receipts.
Host policy storage, feature flag values, risk classification and audit durability
remain explicit ports; this is a shared enforcement/recording foundation, not a
new approval product, policy database or full governance acceptance claim.

## Standing authorization in the Agent starter

The optional `mandates: {authorizeGrant, sourceFor}` configuration now composes
MandateStore and AssistantMandates with the template's current user/application/job
scope. It exposes the host management port, declares Task Mandate references and
connects the existing Runtime checks. Grants are explicit owner operations and do
not become model Tools, automatic approvals or new public HTTP endpoints.

Deferred input validation checks the same grant at scheduling and dispatch. An
initial installed-app check found that relying only on Runtime admission left a
revoked scheduled intent in retry; wiring the existing pre-admission validation
port now blocks it before Task admission. The retained failed log records this
finding; the expectation was not relaxed.

All 42 independent installed examples pass. The new generated-app scenario proves
stable grant identity through reconstruction, tool-scope rejection, authorized
completion, revocation during a model response with no subsequent write, retained
usage accounting, revoked resume/new Task rejection, blocked scheduled admission
and continued Task cancellation. Models are deterministic fixtures. No new Runtime,
Mandate semantics, migration, actual-model evaluation or production deployment is
introduced. Purpose remains explanatory rather than a semantic resource filter;
application permission, model allowance and outcome verification remain separate.

## Actual-model same-owner delegation evidence

At source f37c9ec302039aaabfa1dbdf820ffdb6371d8302, the opt-in
core-real-delegation scenario passed all 16 checks with DeepSeek V4 Flash. Parent
f5a03e7a-0011-4ba3-b2cc-69c49b5b5573 delegated to child
802690e9-6781-46d4-ab30-e942d1473c39 under distinct persistent Agent identities.
The Runtime was reconstructed after persisted delegation. The child read a Skill
and raw records, wrote and read readiness.json; the parent automatically resumed,
read the exact current artifact and finished without writing it or owner input.
Both Tasks succeeded; selected IDs A/D and total units 12 matched the host grader.

Nine actual model calls and eight Tool attempts consumed 25,420 input plus 4,364
output Provider Tokens (29,784 total). The child used four of its ten durable model
admissions. The synthetic shared allowance ledger settled 29,784 platform units
under its explicit 1:1 fixture rule, with zero pending/unknown usage and zero
reserved units. This is not a currency invoice or debit to production users.
No paid retry or runtime change was needed. The source and independent-installed
fixture preflights passed, as did all 42 default installed examples and exact-source
CI 34779735270.

This authored sample adds actual-model collaboration evidence. It is same-owner,
orderly Runtime reconstruction rather than process kill, and not a third-party
blind holdout, cross-principal cancellation/takeover evaluation or full Core
acceptance. Those requirements retain their separate evidence and limits. Latest
runtime prerelease remains candidate.73; no production application was deployed.

## Acceptance evidence consolidation and post-freeze goal

ACCEPTANCE.md maps the eight Note 30 conditions to current code and inspected
examples/evidence. Earlier chronological missing-capability statements do not
supersede later delivered modules. Protocol parity, actual interruption recovery,
cross-principal cancellation/takeover, replaceable defaults and current execution
policy all have specific evidence; they should not be reported as absent modules.
Representative Agent evaluation-to-candidate-release evidence remains a next
acceptance task, alongside the final technical and application deployment audits.

Using frozen source f37c9ec302039aaabfa1dbdf820ffdb6371d8302 and the unchanged
core-real-composition harness, a newly authored combined-queues goal passed all
seven original checks on its first actual DeepSeek V4 Flash run. Run
 da7cbedc-2c3b-4450-aa07-5248705d9c08, Task 9700470e-f2f1-42cb-bf70-957a7483182e,
selected R-03/R-02 with total 11, wrote once and read the artifact back. Six model
requests/eight Tool attempts used 23,765 Provider Tokens; no unknown usage or
remaining reservations. No tools, Skill, grader or execution budget changed.
The private dataset was frozen before inference; this is post-freeze composition
evidence, not a third-party blind benchmark or full Core/application completion.
No new runtime release or production deployment was made for this evidence update.

## Actual Agent evaluation evidence bound to release decisions

The optional prompt-append input in core-real-composition now binds host-supplied
prompt bytes and source revision into a candidate revision before inference;
without it, the original source revision/behavior remain unchanged. Tool scope,
Skill, original verifier, grader and evaluation bounds are not changed. Source
 df29f1f4fe4652abe9bd9f7041d4f881d37f2ddc passed exact CI 34780494478 and all 42
independently installed default examples before candidate model evaluation.

A frozen generic completion-discipline appendix produced candidate revision
f5ab7ed484d08f4daa61741ad43f16551b709ba724085305ead36b739d5a3642. Its actual
DeepSeek V4 Flash capability run 39522f7b-70a5-4f30-b683-f5313b4dddba and separate
regression run 16ae6a7b-f0d7-4207-9c59-a410cb843659 each passed all seven unchanged
checks. Baseline f37c9ec uses the retained post-freeze capability run and new
regression run dbefbe64-4d1d-473e-945f-11d7f1c86089. Dataset/grader/environment/
repeat pins are matched separately per suite; comparisons show no regressions.
These are one-repeat authored samples, not a statistical improvement claim.

The new opt-in core-evaluated-release consumer loads those actual immutable
EvaluationStore snapshots and uses existing ReleaseManager, ObjectStorage,
ReleaseResources and ReleaseBoundAgentIdentity modules. Independently installed
execution against PostgreSQL verifies rejected wrong-version evidence, a rejected
explicitly injected startup-failure evaluation, baseline/canary registration,
checked archive/config/prompt bytes, revoked candidate bindings, one rollback
receipt and baseline recovery after service reconstruction. The failure fixture
makes no provider requests. Rollback is an authorized acceptance drill, not a
claim that telemetry detected a regression in the passing candidate.

The three new model stages used 62,609 Provider Tokens: baseline regression
23,741, candidate capability 19,866 and candidate regression 19,002. All usage is
confirmed and settled; fixture allowance uses the declared 1:1 unit rule. The
previous baseline capability's 23,765 Tokens are not charged/count-added again.
No paid retry, post-release inference or production deployment occurred. This
connects actual Agent evaluation to local release selection/resource/current-binding
checks; existing Runtime-stop and observation/Docker evidence remains separate.

## Business Capability injection in generated Agent applications

The Agent starter now accepts optional `extraCapabilities`, forwarding existing
host-defined contracts into createAgentTaskCapabilities and the shared Dispatcher.
Applications can import business operations from their own domain modules without
editing the template's internal composition. Job and per-Task scopes, current
application access and each operation's own authorizer remain independent checks.
The HTTP entry discovers the same declared operations. Core owns no domain tables
or transaction rules; the host verifier checks authoritative application results.

All 42 independent installed examples pass. The new generated-app check uses an
application-owned PostgreSQL total, denies an out-of-policy amount and another
owner, reconstructs after Agent Task admission, and verifies one business write,
two fixture model calls and settled allowance. The same HTTP contract denies an
unauthorized amount; removing the operation from the job scope prevents further
execution. No actual model, new execution engine or production deployment is used.

The host must include added domain executable resources in its Runtime revision
or evaluated release binding. The starter's existing default hash cannot discover
arbitrary imported modules/external service changes. This is a basic application
composition port, not automatic business-code loading or a new plugin lifecycle.

## 2026-09-14 — Generated Agent applications bind evaluated releases

The Agent starter now accepts optional releaseBinding with the existing release
service, pinned reference and explicit implementation revision. It decorates the
existing registry identity using ReleaseBoundAgentIdentity instead of adding a
second Runtime, release-management Tool or UI. Application version must match the
binding. Hosts still load checked code/configuration and own deployment policy;
a revision string alone cannot prove those bytes were loaded.

The generated-app installed test uses real PostgreSQL release records, separate
deterministic capability/regression evaluation fixtures, a canary and fallback.
A candidate Task survives application reconstruction with its original binding.
Stopping the candidate while its next model response returns prevents the proposed
Workspace write: zero Tool receipts, no artifact, current Task waiting, new
candidate admission denied. The two occurred fixture inferences still settle four
platform units. A newly constructed fallback application cannot resume the old
candidate Task; a separately admitted fallback Task succeeds, charging two further
units. The worker cannot stop releases and receives no release-management Tool.
These are deterministic integration fixtures, not actual-model quality evidence,
checked resource loading, production deployment or full acceptance.

Verification: generated application installed tests and all 42 independent Core
examples passed. Initial verification attempts used the template source without
its generated vendor archive, then omitted required fixture dataset category and
grader score fields; those setup failures were corrected without changing the
release gates. Evidence is in ImmediToday-evidence/2026-09-14/core-starter-release,
including failed/successful developer logs and the successful installed package.
ImmediToday production remains on candidate.74; this optional starter integration
does not require another application dependency deployment.

## 2026-09-14 — Preserve safe diagnostics for unresolved model usage

A real ImmediToday Pro-model development probe entered usage reconciliation after
three measured responses; four subsequent unresolved requests retained allowance
holds but the wrapper discarded their provider errors. Historical evidence cannot
now identify their HTTP status or prove rate limiting. Those attempts remain
unaccepted with their original unknown reservations.

meteredModel now retains an enumerated failure kind, internal request ID and any
bounded HTTP status, Retry-After or completion boolean in its unknown ledger entry
and reconciliation error. Runtime validates the shared usage-diagnostic contract
and projects it into the existing model_usage event. It excludes raw messages,
bodies, headers, credentials and arbitrary provider fields. This adds traceability,
not permission to settle/release unknown use or retry failed requests.

Real PostgreSQL integration injects a 429 error without measured usage, verifies
matching ledger/history request diagnostics across store reconstruction, no leaked
message/header, one provider call, unchanged reservation and no model_retry event.
Another attempted call on the same unresolved Task is still blocked. All323 module
checks passed without skips and all42 independently installed examples passed.
Evidence: ImmediToday-evidence/2026-09-14/core-usage-diagnostics. The related real
model run is retained in issue-quality-pro; no new real inference, production
model switch or full quality acceptance is implied by this diagnostic fix.

## 2026-09-14 — Shared model admission spacing and bounded waiting

A new actual ImmediToday Pro diagnostic retained HTTP429 on its fourth request;
three earlier calls measured15470 Provider Tokens. Huawei international model
listing documents default Pro RPM3/TPM30000. This supports investigating request
pacing, but does not prove the account quota or retroactively classify older
failures whose status was lost. The original unknown request and allowance hold
remain retained; there was no paid retry or production model change here.

PostgresModelRateLimits now optionally persists minimumIntervalMs per namespace
(default0, maximum60000). The existing database lock serializes admission across
workers. Independent admission timestamps enforce the gap across reconstruction
and fixed-minute boundaries; confirmed non-dispatch is excluded, while unknown
and settled calls count. Old tables migrate with zero spacing and preserve their
receipts; changed namespace configuration still rejects. This is admission pacing,
not a guarantee of wire-send spacing after downstream scheduling or other clients.

rateLimitedModel optionally waits within admissionWaitMs (default0, maximum60000)
for local rate admission, preserving original Task/turn and cancellation. It stays
inside the Runtime inference deadline and does not consume extra model turns or
provider attempts. Provider execution happens at most once and provider errors
never enter the local waiting loop. Unresolved provider usage remains subject to
the existing reconciliation policy. No durable/fair queue or automatic Task
resumption was added.

All328 module checks passed without skips. New actual PostgreSQL fixtures cover
contention, reconstruction, minute boundaries, unchanged unknown receipts, legacy
migration and no model call/platform debit on rejected admission. Waiting tests
cover cancellation, budget exhaustion and no retry of a provider429. All42
independently installed examples pass; provider-cost now checks reconstructed
spacing and an actual short database-timed admission wait with one fixture model
call. Controlled timestamp aging is not a provider or crash-recovery experiment.
Evidence: ImmediToday-evidence/2026-09-14/core-model-spacing.

This supplies a reusable missing rate-control capability. ImmediToday remains on
candidate.76; application composition, appropriate request Token bounds and new
real-provider quality evaluation remain next steps. Full Note30/40 acceptance is
not established by these fixtures.

## 2026-09-14 — Versioned total completion Token budgets

The native ERP development batch on application PR137/Core77 completed zero of four
goals and retained four unknown model usages. Ten measured outputs exceeded the
adapter's 4096 max_tokens setting. Huawei's matching compatible API documents that
this field excludes reasoning; max_completion_tokens includes reasoning and answer.
The former application's estimate is therefore not a proven total-output bound,
even though no actual rate reservation overrun was observed in that batch.

Model invocation policy now accepts explicit maxCompletionTokens (positive integer,
at most1048576), bound into system profile and BYOK endpoint revisions. Responses
uses max_output_tokens; compatible Chat uses max_completion_tokens without also
sending max_tokens. The policy overrides the legacy provider maxOutputTokens
argument. Omission preserves legacy wire behavior and identity. Unsupported fields
are not silently downgraded or retried. This adds a missing reusable model control;
applications must select supported limits and align admission estimation.

All331 module checks passed without skips, and42 independently installed examples
passed. The model-routing example uses the public profile, provider and metering
ports with an injected truncated response:8192 output Tokens (including8000 reasoning)
and10 input Tokens are charged once, no task success or unknown usage is invented.
Fixtures also verify transport fields, unchanged legacy behavior, model-identity
fences before secret access, BYOK endpoint binding and unsupported-policy errors.
Evidence: ImmediToday-evidence/2026-09-14/core-completion-budget. This validation is
deterministic; application adoption and actual-provider behavior still require
separate verification. Full Note30/40 acceptance remains incomplete.

## 2026-09-14 — Explicit versioned model reasoning effort

The independent real GLM-5.2 grader completed two calls but missed a material
source/claim contradiction. Those original scores and the developer disagreement
remain retained; separate-model grading is not automatic semantic acceptance.
Provider documentation also shows model-specific default reasoning policies,
which the Core configuration previously could not select explicitly.

Model invocation now accepts reasoningEffort (none, minimal, low, medium, high,
xhigh, max). Responses maps it to reasoning.effort and compatible Chat to
reasoning_effort. Labels are preserved, with provider/model support and meaning
left explicit to the host. Omission preserves prior wire defaults and identities.
System profile and BYOK endpoint revisions include this policy; changing only the
policy fences old bindings. Provider rejections never trigger a silent default,
downgrade or retry. This does not change total completion limits, time/turn/tool
budgets, platform allowance, currency prices or hidden-reasoning handling.

All334 module checks passed without skips, plus42 independently installed
examples. Transport fixtures cover explicit values, omission, hidden-reasoning
exclusion and unchanged usage; profile/BYOK fixtures cover revision fencing and
invalid policy rejection. The installed model-routing example uses the actual
profile/provider/metering composition with injected truncation and confirms the
reasoning field alongside total-output accounting. Initial new BYOK test assumed
public endpoint metadata exposed its internal revision; the failed assertion is
retained and corrected to derive the existing canonical endpoint revision.
Evidence: ImmediToday-evidence/2026-09-14/core-reasoning-policy.

These checks establish configurable foundation behavior, not improved real-model
latency, quality or full Note30/40 acceptance. ImmediToday remains on candidate.78
until it explicitly adopts the new package; production model settings are unchanged.

## 2026-09-14 — Caller-safe business preflight correction feedback

A full inspection corrected the previous application experiment's analysis:
Schema rejection already included /content, type, must be object, and the Context
assembler retained it. The summary had extracted only the generic error string.
Original evidence and a separate correction are retained. This change targets the
actual missing business-preflight explanation, not that existing Schema path.

Function capability preflight now accepts a boolean or a strict {valid,feedback?}
result. Feedback is optional public host content bounded to2000 characters. Failed
checks remain before side effects; invalid result shapes cannot authorize a write.
Authorized feedback is included in the shared error message and Runtime Task event,
so it survives context assembly and reconstruction. The host owns safe domain
wording; arbitrary upstream exception content is not automatically forwarded.
Permissions, input schemas, execution policy, cancellation, original error receipts
and output verification remain separate checks. No coercion or retry is added.

All336 module checks and42 independently installed examples passed without skips.
Tests verify shared entry projections, authorization before preflight, invalid
structured results, and one eventual write after rejection, waiting and Runtime
reconstruction. The installed neutral notes example rejects an incorrect preference,
observes the feedback and persists the corrected original preference once. These
are deterministic recovery checks, not actual-model quality or process-kill proof.
The initial reconstruction test incorrectly counted the separate wait-question
feedback as another preflight error; the retained fixture failure was corrected to
count the identified capability's rejection. Evidence is in
ImmediToday-evidence/2026-09-14/core-preflight-feedback.

ImmediToday remains on candidate.79 until explicit package adoption. The previous
GLM/high four-class development batch completed4/4 but retained material semantic
errors in two reports. Full Note30/39/40 acceptance is still incomplete.

## Deadline cancellation classification (candidate.81)

Model invocation cancellation now retains the Runtime deadline reason even when
an adapter immediately rejects with a replacement transport error. Usage and
bounded diagnostics are recorded first. Expired requests cannot enter provider
retry or invalid-action correction, and a response resolving during abort cannot
submit successful completion. Ordinary failures retain interrupted status; missing
usage remains unknown. Active Task deadlines and model deadlines share this rule.

339 module checks and 42 independently installed examples passed without skips.
The same new regression tests against candidate.80 reproduce an expired 429 retry
and acceptance of completion returned during model cancellation. The initial test
fixture added an async wrapper that let the timeout promise win before available
usage; that fixture was corrected to use the adapter's direct promise, and both
failed fixture logs were retained. ImmediToday's original interrupted-vs-limit
integration failure is retained separately. No real-model quality pass is inferred,
no timeout defaults change here, and no historical Task or usage is rewritten.
