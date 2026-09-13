# Personal Assistant tasks

`createAssistantTaskCapabilities({memory, workspace, skillCatalog, authorize, verifyOutcome, extraCapabilities})` combines the existing module interfaces into deterministic tools and one `assistant.run` Agent capability. It does not create a second Runtime, model gateway, quota ledger or UI. Register the returned capabilities in the ordinary dispatcher. Model identity, allowance handling, waiting/resume/cancel and durable history remain owned by the shared Runtime and model modules.

Input: `goal`, optional `requiredArtifacts` (logical document paths) and `allowedTools` (explicit subset of registered tool names). By default, registered reads and workspace writes are allowed. Memory mutation, deletion and additional business writes need explicit inclusion in allowedTools. Actual actor authorization still runs before every operation. The Runtime's allowCall check enforces the task subset even if a model sees or requests another tool. A Skill is a method and cannot change this boundary.

Output: `summary` and exact `artifacts` references. Core checks that requested paths are returned, references resolve under current ownership and each reference was obtained in a successful tool call in this task. The host must also supply verifyOutcome; no model chooses or replaces that verifier. The ImmediToday generic verifier currently confirms completed tool evidence and reference integrity, not semantic correctness of every sentence. Quality and broader business outcomes require task-specific evaluation; a succeeded state must not be presented as universal semantic acceptance.

Memory read history is refreshed through the Memory interface; memory-write receipts omit content. Workspace history resolves exact versions and marks deleted documents unavailable rather than restoring their body to context. This sanitizes returned/reassembled tool results, not raw persistent audit events or externally copied content. Cross-system deletion propagation remains unfinished.

The application may inject extra deterministic capabilities such as a permission-checked business Task read; Core knows no ERP types. ImmediToday provides POST `/api/assistant-tasks` and personal MCP `my_start_assistant_task`, then uses the existing `/api/agent-tasks/:id` and task tools for history, input, resume, model switching and cancellation. Current runtime/pilot admission controls still apply; installing these capabilities alone does not enable production execution.

Focused test: `test/iaic-assistant-tasks.integration.test.js` checks lifecycle through application entrypoints, restart without duplicate writes, task tool bounds, reference validation and deleted-content revalidation. `examples/core-assistant` shows independent composition with a concrete checklist quality verifier. Unknown write responses still pause for reconciliation; this module does not pretend a failed response proves no write occurred.

Optional `knowledge` injects a sourced reference catalog. Search/read become ordinary read capabilities, with current per-record authorization and version revalidation before historical content is reused. It neither installs Skills nor converts references into business facts. See `../knowledge/README.md`.

Optional `sessions` adds `session:{id,throughSequence}` to task input and a read tool restricted to that exact Session/snapshot. The application composes `startSessionTask` with the same stable task request key and injects a Session context provider. See `../sessions/README.md` for the durable timeline and recovery contract.

## Multiple Agent compositions

`createAgentTaskCapabilities` is the role-neutral export of the same implementation. `createAssistantTaskCapabilities` remains a compatible alias with unchanged defaults. The host may set `name` (default `assistant.run`), `description` (default personal-work description), and `toolNamespace` (default empty). For example, `{name:'business.work', toolNamespace:'business', ...ports}` exposes `business.my_read_workspace`, `business.assistant.skills.read` and the other injected resource tools. Tool subsets, Session/Event restrictions, history refresh and artifact verification use these exposed names. Supply the actual exposed names in `allowedTools`.

The host injects separately scoped Memory, Workspace, Knowledge, Session, Event and Skill interfaces as needed. A prefix prevents naming collisions; it does not create a principal, change authorization, isolate storage, allocate a wallet or grant business authority. Bind authenticated Agent identities through `AgentRegistry`; route the shared Runtime's `resolveModel({actor,agent,modelIdentity})` to the appropriate `AssistantModels` instance. Model settings already support a trusted Agent resource scope. Billing accounts are explicitly application/subject scoped; `assistantId` alone does not create a separate wallet. Applications choose whether Agents share an account.

`extraCapabilities` retain their host-defined names and authorization. All names registered in a dispatcher must remain unique; duplicate names fail explicitly. There is no automatic deduplication, hidden registry or container. Applications with shared domain tools choose explicit adapters/composition instead of silently overwriting another definition.

`examples/core-agent-composition/run.mjs` independently installs Core and exercises three authenticated fixture identities on one Runtime, separate memory/workspace resources at identical keys/paths, persisted model settings, original-task model pinning after a default change, and separate fixture platform allowance accounts. Deterministic models and PostgreSQL prove composition contracts; they do not establish real-model quality, production service principals or autonomous business/platform work. No UI is provided.

Optional `deferred` adds explicit one-time future work via the existing scheduling capability; see `../deferred/README.md`. Scheduling confirms an intent, not the future outcome. No scheduling UI is supplied.

For application-configured jobs, resource ports may resolve the job from the trusted actor rather than creating another bundle per job. `examples/core-configurable-jobs` uses one `job.work` capability with `AgentRegistry.register`, application-owned JSON configuration, per-user-plus-organization defaults and an organization-shared job. Existing model, memory, knowledge and Skill modules remain independent. See `../identities/README.md` for configuration revision and host persistence responsibilities.

## Session and proactive work composition

`createAgentSessions({store,resolveScope,readTask,readArtifact,...sessionOptions})` composes the existing Session timeline with current Task and Artifact read ports. It returns `AssistantSessions`; no new state or UI. Its task projection checks the Task's Session binding and includes current status, goal and accessible artifact references, never copied artifact bodies. Both read ports must enforce current host authorization. `resolveScope` can use the same configured user-plus-organization or shared job scope as Memory and Workspace.

`createAgentDeferredTasks({name='assistant.run',store,resolveScope,restoreActor,dispatcher,sessions,taskStore,startTask?,validateTask?,isEnabled?,triggers?,reservedPrefixes?,logger?})` returns the existing DeferredTasks worker. It validates the named Agent capability and explicit nonempty allowedTools, calls optional host `validateTask(actor,input,trigger)` for additional policy, and uses ordinary current capability authorization. Default admission invokes the Dispatcher and links the Session through `startSessionTask`; an optional `startTask(actor,input,key)` preserves an application's admission route. Receipt recovery compares exact task input and repairs its Session reference when current access permits. A denied association does not erase an already admitted Task or replay work.

The host supplies authenticated actor restoration for background work and reserves `deferred:` Task keys against public callers. Intent keys default to the existing `agent-call:` reservation; hosts using recurring work must also reserve its prefix. Scope and restored actor must retain organization, job and the principal under whose authority work runs. A shared resource scope does not decide Task ownership: applications explicitly choose a member or service principal and current access policy.

Compose these ports with `createAgentTaskCapabilities({sessions,deferred,...})` and the existing Runtime Session context provider. Closing a Session stops new messages; accepted work remains independent and can append Task receipts/results while closed. A future Task uses the current model selection and platform allowance; its parent retains its own model binding. Read the linked Task to determine completion rather than treating a scheduling receipt as an outcome.

The independently installed `core-configurable-jobs` example now exercises this entire path: model reads Session, schedules future work, conversation closes, services rebuild, future work uses the same job resources and pinned Session, and its current result appears in that Session. ImmediToday's Session and deferred adapters use these same Core helpers, retaining ERP actor mapping and business-source/Mandate policy in the application.

### Application outcome feedback

`verifyOutcome(input, result, context)` may return the existing boolean or a plain
`{verified: boolean, feedback?: string}` object. Feedback must be a nonblank string
of at most 2,000 characters. Unknown fields and invalid verdicts fail explicitly;
a truthy object does not by itself grant success. The same contract applies to a
Capability's `implementation.verify` when used directly with AgentRuntime.

Runtime records the trusted verdict and optional feedback in the durable
verification event. Context assembly includes it in the next model turn and after
reconstruction, so a rejected proposal can be corrected without guessing why it
failed. Output-schema rejection supplies a generic structure correction message
and does not call the application verifier. Assistant artifact/evidence checks
remain prerequisites and can still reject before verifyOutcome is invoked.

Applications should provide actionable, current-authorized feedback suitable for
the Agent and authorized Task history readers. Do not expose private grader answers
or inaccessible source content merely to improve a score. Feedback is guidance,
not a tool grant, new user instruction or permission to weaken the completion rule.
The verifier must run again on the corrected result; Core never converts feedback
or an Agent's claim into success. Existing task/turn limits and cancellation still
apply. This is a basic execution contract, not an application-specific rubric or
an automatic guarantee that the model will correct its work.

### Direct outcomes without unnecessary tool calls

A task may finish without a successful Tool call when the application can verify
its outcome from the authorized goal/context or its own authoritative sources.
Core no longer requires a nonempty successful-call history before invoking
verifyOutcome. A tool invocation is not by itself proof of a correct answer.
Applications that require particular source reads or effects must check that
through their verifier, as the existing real-model evaluation applications do.

This does not bypass output validation, requiredArtifacts or reference integrity.
Every claimed artifact still needs an exact reference obtained through a successful
workspace read/write in this Task and a current authorized read. Missing required
artifacts and invented references fail before the application verifier. The host
verifier remains mandatory and can reject a direct answer, provide correction
feedback or impose its domain-specific evidence requirements. No model decides
that its own answer is verified.
