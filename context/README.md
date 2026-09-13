# Context assembly

`ContextAssembler` assembles a bounded model snapshot from the current Task, authorized/revalidated call history, scoped Memory and Session ports, and a registered Skill catalog/root. It owns no persistence, UI, model execution or application policy. `execution.js` carries the current cancellation signal.

The original goal and tool ceiling remain intact. TaskStore supplies events in durable sequence order. Input, feedback and verification events retain their sequence; call_settled events reference the revalidated calls by ID. These references preserve whether a user clarification happened before or after a tool result, without duplicating result bodies or exposing raw model responses. Missing call references are omitted; an event does not invent a result. Never rebuild context from raw historical results to bypass current source access.

Later user input clarifies the ongoing goal; it does not grant capabilities or resource access. The prompt directs the model to use existing successful results and propose completion through the existing controls. This does not detect arbitrary loops or prove model quality. Runtime limits and application verification remain responsible for their existing checks.

Focused tests: `test/iaic-context.test.js`; Runtime, Memory, Session and Assistant integration tests exercise the injected ports.

Optional `handoffProvider({actor,task})` supplies a fresh bounded projection under data.handoffs. Context owns no Handoff storage and imports no Handoff or application implementation. The provider must enforce current parent/child/source access; the snapshot counts toward maxBytes. The system guidance treats summaries as evidence, unavailable/hasMore as incomplete coverage, and child artifacts as reusable sources rather than a requirement to repeat child work. It does not turn a child result into a user instruction, a permission grant or proof of the parent goal. Hosts choose which Agent capabilities receive the provider.

Historical inputs can themselves contain stale private content even after result revalidation. Context therefore consumes an optional capability `projectHistoryInput` hook after authorization and source refresh. It passes a cloned argument object and never changes durable inputs used by recovery or verifiers. A projected call carries `inputProjected:true`; these displayed arguments cannot be used as an exact replay request. The resource module decides its projection; Context imports no Memory, ERP or application implementation. Missing hooks retain existing behavior. Invalid projection output interrupts instead of falling back to raw arguments.

Memory descriptors omit write content, dispute reasons, import snapshots and query text from historical arguments. Fresh read/list/export results still govern the memory content visible now. Original Task goals, explicit input events, Session messages, raw audit/model-response events, other capabilities and previously exported files have separate retention policies; this is not whole-account erasure. Runtime model context already omits raw model-response events, while authorized audit APIs may still return them. Tests: `test/iaic-history-input-projection.test.js`, `test/iaic-memory-context-projection.integration.test.js`.

## Bounded historical result projection

`overflow: 'omit-old-results'` enables deterministic, display-only context
compaction when the assembled JSON exceeds `maxBytes`. The default remains
`'error'`. All historical calls are authorized and revalidated first. Older
successful result bodies may become `result: null, resultOmitted: true`, with
explicit `contextProjection.omittedResultCallIds`. This is not a generated
summary, stored memory, failed operation, or permission to repeat a write.

The most recently settled call's result stays intact, as do goals, user input,
operation identities, statuses, displayed arguments, failed/unknown calls,
Skill/Memory/Session inputs and event ordering. If these retained materials still
exceed the limit, normal `limitReached` behavior applies. `maxBytes` retains its
existing meaning: the assembled JSON data budget, not provider Tokens or the
complete system-prompt byte count. Result elision is not unlimited-context support.

The original Task history, results, receipts and authorized history APIs are
unchanged. Agents needing omitted content must use available authorized resource
reads or original-result queries; do not replay effects to retrieve old output.
A task with no such read/query ability may need clarification or takeover.
The generated Agent template opts in; other applications choose explicitly.
Reconstruction produces the projection from durable history and current sources,
with no model call or platform debit for compaction itself.

Verification includes a PostgreSQL Task that reads two sources, compacts an old
large result, waits for input, reconstructs Runtime and finishes without repeating
the reads. This is deterministic evidence, not actual-model acceptance.
