# Agent runtime and model protocol

## Total model output budget

An optional model/profile invocation policy, for example
`invocation: {maxCompletionTokens: 8192}`, requests a combined answer-and-reasoning
output ceiling. The value must be an integer from 1 to 1,048,576; the host must
choose a limit supported by its provider/model. It overrides the provider's legacy
`maxOutputTokens` argument. Responses sends `max_output_tokens`; compatible Chat
Completions sends `max_completion_tokens` and omits `max_tokens`. An unsupported
endpoint error is retained, without automatic fallback or retry.

Omission preserves existing wire behavior and profile identities. In particular,
legacy Chat `max_tokens` is not a portable bound on reasoning plus answer Tokens.
Explicit policies participate in ModelProfiles and BYOK endpoint revisions, so
old tasks/credentials cannot silently adopt a different policy. Applications must
align their rate-admission output estimate with this configured ceiling. A request
parameter alone is not measured usage or proof that a provider enforced it.

Truncation remains an incomplete response, never successful task completion.
Available output usage, including reasoning, is retained and metered once; unknown
use remains subject to reconciliation. The setting does not change Runtime time,
turn or Tool budgets, platform allowance, or monetary price. Provider support must
be verified before using it for real work. See the
[Huawei compatible API specification](https://support.huaweicloud.com/intl/en-us/model-call-maas/model-call-021.html)
for the concrete distinction that motivated this addition. Focused checks live in
`test/iaic-model-invocation.test.js`; the independent model-routing example covers
the configured field and metered truncated usage through public module contracts.

## Explicit reasoning policy

Profiles and approved BYOK endpoints may also set
`invocation: {reasoningEffort: 'high', maxCompletionTokens: 8192}`.
Accepted policy labels are `none`, `minimal`, `low`, `medium`, `high`, `xhigh`
and `max`. This is a transport vocabulary, not a claim that every model supports
all labels or that labels have equivalent meanings across providers. The host
selects a supported value and evaluates it for the task. Responses sends
`reasoning: {effort: value}`; compatible Chat sends `reasoning_effort: value`.
The exact selected label is preserved without remapping. Omission sends neither
field and preserves existing profile identities and provider defaults.

The policy is immutable and included in system profile and BYOK endpoint
revisions. Changing only reasoning effort fences old model identities before
secret access. A provider rejection remains an error with no automatic retry or
fallback to another effort. Total output, time, turn and allowance budgets remain
independent controls; this option does not expose or persist hidden reasoning.
Provider acceptance alone is not evidence of improved quality or reduced cost.

See [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.5)
and [Huawei compatible API](https://support.huaweicloud.com/intl/en-us/model-call-maas/model-call-021.html).
For example, Huawei documents GLM-5.2 default `max`, with `low`/`medium` mapped by
the provider to `high`; DeepSeek V4 has different supported behavior. Core does
not silently reinterpret those provider-specific semantics. Model policy belongs
to configuration, not a Skill or a model-selected Tool argument.

## Per-tool Task attempt ceilings

Host Agent definitions may set `implementation.toolCallLimits`, for example
`{'my_remember_assistant_memory': 1}`. Keys must be declared Tool names and values
nonnegative safe integers; zero disables new attempts. The definition snapshots
the map. `createAgentTaskCapabilities` and generated Agent `openApplication`
accept the same optional `toolCallLimits` argument, using final exposed names.
This is trusted application configuration, not a model-selected input field.
Version changes to this policy with the Agent implementation and Runtime version.

Runtime counts every durable prepared call for that Tool in the current Task,
including failed, unknown and reconciled attempts. It publishes remaining counts,
omits exhausted Tools from inference discovery, and checks again before preparing
each single or batch action. An exhausted batch step closes the remaining batch
with feedback. Restart, clarification and reconciliation do not reset the count;
other permitted Tools and the existing outcome verifier remain available. An
unknown effect still requires reconciliation before further execution.

These limits are per Task, not per memory key or operation, and do not infer
once-only constraints from natural language. They do not suppress identical writes,
turn failure into success, or create idempotent business effects. Direct Capability
calls and existing readiness/history reads are outside this attempt count. Child
and scheduled Tasks have their own ceilings; use existing delegation/shared budget
policies for aggregate limits across Tasks. Current permissions, Mandates, grant
budgets and the total Runtime limits continue to apply. No default limit is added.

PostgreSQL evidence: `test/iaic-tool-call-limits.integration.test.js` covers repeated
batch writes, lost acknowledgements, preflight rejection, reconstruction, current
revocation, model attempts despite exhausted discovery, and retained outcome checks.

`runtime.js` owns durable execution against injected task, capability, context and model interfaces. Provider implementations translate model protocols; they do not grant permissions or verify application outcomes. `openai-provider.js` and `model-provider.js` support Responses and compatible Chat Completions respectively.

`tool-names.js` preserves protocol-valid function names (letters, digits, underscore/hyphen, at most 64 characters). Other names receive descriptive wire names; deterministic hash suffixes disambiguate normalization/truncation conflicts and reserved control names. Duplicate or unresolved collisions fail before sending a model request. Reordering the same tools does not rename them. The provider decodes only the names it actually advertised, preserving the original capability identity in task history. There is no fallback from an unknown name to an undeclared tool.

The provider still requires exactly one function action. Multiple calls are rejected without executing any, with their count in recovery feedback. Finish/wait controls remain separate from business capabilities. Permissions, task tool bounds, schema validation, write intents and outcome checks run in the existing dispatcher/Runtime. No UI or additional middleware framework is introduced.

Focused verification: `test/iaic-tool-names.test.js`, `test/iaic-openai-provider.test.js`, `test/iaic-model-provider.test.js`. Runtime behavior and application composition have separate integration tests. The Core Assistant reference now uses the same default 20-turn Runtime budget as the application rather than a separate 12-turn fixture override; its content/evidence verifier is unchanged.

Protocol reference: https://developers.openai.com/api/reference/resources/chat . This wire-name change is versioned with application source. It does not migrate tasks pinned to an earlier implementation revision or demonstrate general model-quality acceptance.


Optional `agentIdentity.bind/check` ports bind tasks to a persistent work subject and recheck lifecycle around model/tool admission. `resolveModel` also receives the Agent binding for host-specific per-Agent configuration. The same Runtime supports user, business and platform roles; roles never bypass capability authorization. See `../identities/README.md` for pause, legacy-task and compatibility limits.

Optional `mandates.checkTask` revalidates explicit `input.mandate` references around admission, inference and tool intent preparation. Missing resolvers fail closed for bound tasks. It is independent of Agent identity and does not replace current capability permission. See `../mandates/README.md`.

Task input may include `allowedTools`, a unique subset of the Agent capability tool names. Runtime validates it before Task creation and uses the same subset for model discovery, call admission and Dispatcher context, with or without a Mandate. An empty list allows only finish/wait controls; omission preserves the declared Agent tool set. This is a task-level ceiling, never an authorization grant; current permissions, Mandates and domain `allowCall` rules still apply. The persisted input is not expanded on resume. This provides a prerequisite for bounded task handoff, not a completed delegation or shared-budget protocol. Focused coverage lives in `test/iaic-runtime.integration.test.js`.

The optional `handoffs` port binds reserved child admission keys, checks lifecycle and parent domain restrictions, limits model admissions, reconciles receipts before dispatch, and propagates parent cancellation through existing Task controls. It is independent of the Runtime and adds no executor. See `../handoffs/README.md`.

Chat `finish_reason=stop` is a completed response, but free text is not an executable IAiC action. It produces zero-action correction feedback in the original bounded Runtime loop; it is never converted into a tool, wait or final result. Only `tool_calls` admits a proposed wire call. Length produces `model_output_limit`; content filtering, insufficient system resources and unknown terminal reasons produce `provider_error`, with an allow-listed reason in the error. Failed-response usage remains chargeable through the original gateway. This is protocol classification, not automatic replay of business actions or a new retry loop. See https://api-docs.deepseek.com/api/create-chat-completion/ .

## Waiting for a deterministic external result

A read function capability may define `waitReady(input,result,{actor}) -> boolean` and must provide current `revalidate`. A model calls that capability explicitly using the ordinary tool protocol. False readiness settles the read and atomically records a `result_wait` on the original Task, with `waiting_reason=external_result`. This is separate from `iaic_wait`, which still asks for user input. Direct Dispatcher/API calls return immediately; suspension applies only inside the Agent Runtime.

`result-waits.js` consumes explicit TaskStore and Dispatcher ports plus Runtime authorization. The existing executor checks at most one pending wait per second, with a five-second observation timeout and round-robin cursor. It rechecks current Agent/Task/tool/Mandate/Handoff authorization and invokes only the declared read. It does not call the model or replay a write. Readiness queues the same version-pinned Task; context revalidation and model/allowance checks still run before subsequent work. Ready means the external condition can be handled, not that the goal succeeded.

PostgreSQL owns the call and wait receipt. The in-memory cursor is disposable. Lost observations leave the wait intact; process replacement can rediscover it. Atomic compare-and-set wake checks the original wait event, so cancellation, explicit manual resume and a later user-input wait win over stale observations. Reads that time out or lose permission leave the Task waiting. They do not generate per-poll history or imply successful completion. Polling is bounded state observation, not guaranteed event delivery/latency at arbitrary scale. Capabilities must keep reads bounded and honor cancellation; timing out cannot forcibly stop a host's noncooperative I/O.

No new table, worker, model protocol or UI is introduced. Older implementations leave these Tasks in external_result, and the existing version fence prevents silent execution on rollback. Existing uncertain-call waits have no result_wait receipt and are never automatically reconciled. Focused coverage: `test/iaic-result-waits*.test.js`; standalone package consumer: `examples/core-result-waits/run.mjs`.

## Model-initiated delegation

`delegation.js` adds one optional Runtime control, `iaic_delegate`. A host-accepted Task input explicitly fixes `delegation: {capability, maxModelCalls, timeoutMs}` and `allowedTools`. The model supplies only goal, success criteria, narrower tools and artifact references. Proposal validation precedes durable suspension. Each Task can create at most one automatic child; bound children cannot delegate. `maxModelCalls` counts child inference admissions, not provider tokens or issued platform allowance. Model resolution and billing still use their existing modules.

TaskStore persists the intent and wait atomically. The existing Runtime observer recovers one pending intent per tick and calls the public Handoff receipt/admission ports with a stable key. A terminal child or expiration before admission queues the original version-pinned parent with a result-reference event; current Context revalidation and the original parent verifier still apply. The observer performs no inference. Cancellation and receipt races are fenced under the Task lock. Failed authority checks remain pending and are logged; there is no automatic grant, source permission bypass or retry of business writes.

The host exposes allowed target names through `createAgentTaskCapabilities({delegationTargets})`; ImmediToday currently allows only `assistant.run` under the same owner. This is not independent Business/Platform principal delegation, nested workflows or shared-cost allocation. Existing owner-created handoffs retain their waiting-for-input contract. No UI or second executor. Focused tests: `test/iaic-delegation*.test.js`.

## Completing at the tool-call boundary

When the final permitted tool call has settled and model turns remain, Runtime offers one completion-only inference with no tools or delegation. The model may propose a final result for the unchanged application verifier or ask for essential input. A further tool/delegation proposal, invalid completion, or failed protocol recovery cannot obtain another completion-only request; the durable model_requested event records the opportunity. Uncertain external calls still wait for reconciliation before any inference.

This does not raise maxCalls or maxTurns, forgive failed calls, or guarantee success. The extra inference within the existing turn budget uses normal model admission, allowance charging, authorization and deadlines. Once maxTurns is reached there is no final inference. Older task versions are not silently migrated. The retained real-model Session-continuity sample remains partial; this change has deterministic persistence coverage and does not certify that sample or general model quality.


Optional shared provider concurrency admission is supplied by capacityModel and PostgresModelCapacity; see CAPACITY.md for metering composition, persisted uncertain holds and trusted reconciliation. It does not switch a pinned model or change platform allowance rules.

## Deadline cancellation

The Runtime's model and active Task execution deadlines retain their own abort
reason even when a provider rejects with a different transport error. Recorded
provider usage/diagnostics are retained before applying that reason; unknown
usage is not replaced with zero. An expired invocation cannot trigger a rate-limit
retry or submit completion, including a provider resolving during cancellation.
Ordinary provider errors without a Runtime abort use `provider_error`; the model deadline uses `model_timeout`. See [failure policy](MODEL_FAILURES.md). These limits
bound execution; they do not prove that a remote provider stopped or billed zero.
`taskTimeoutMs` applies to an active execution interval, not lifetime across waits.
