# Sessions

A scoped, append-only conversation timeline containing user statements and task references. It is separate from the model context window, user memory, task execution logs and authoritative facts. No chat UI, second Runtime, model provider or allowance ledger.

`SessionStore({pool})` owns its two PostgreSQL tables and initializes `schema.sql`. Scope is `{applicationId,assistantId,subjectId}` supplied by the host. Session creation uses a stable `requestKey`; repeated identical creation returns the same session. Reusing a key with changed input returns 409. Reads/listing are scoped; another owner sees 404 or an empty list.

`AssistantSessions({store,resolveScope,taskView?})` exposes:

- `create(actor,{requestKey,title?})` and `list(actor,{after?,limit?})`.
- `appendMessage(actor,{sessionId,text,requestKey,expectedSequence})`: bounded user text with optimistic sequence checking. Concurrent conflicting writers receive 409; replay of the identical key/payload returns its original event even after newer events exist. Appending does not invoke a model or create a Memory.
- `read(actor,{sessionId,after?,throughSequence?,limit?})`: ordered events and pagination. A specified throughSequence is immutable even when later events arrive.
- `validate(actor,{id,throughSequence})` and `context(actor,reference)`: explicit snapshot authorization and bounded context reconstruction. The default context includes the latest 20 events at that snapshot, with an explicit omittedEarlierEvents count; earlier events remain available through paginated reads. Oversized context fails explicitly, without silently dropping more data.
- `linkTask(actor,{sessionId,taskId})`: a trusted composition operation requiring a current taskView resolver; stores only a task reference, with an idempotent task-based key. It is not exposed as a free-form user event writer.

The injected taskView resolves current permission and the minimal task metadata/artifact references permitted in context. It must reject inaccessible tasks. ImmediToday checks the task's Session binding and current task/artifact visibility, returns goal/status/references and never copies artifact bodies or generated summaries into the timeline. Unavailable task views are marked unavailable. User message history remains a user statement; forgetting a separate Memory does not erase a Session message.

`startSessionTask({sessions,actor,input,startTask})` composes snapshot validation, the host's existing idempotent task start and reference append. The caller must supply the same task request key and exact snapshot on retries. Task creation and reference append are separate durable operations, not a cross-module transaction; if their response is lost, replay repairs/completes the reference without another task. No automatic orphan-reference repair worker is provided yet.

`createAssistantTaskCapabilities({sessions,...})` enables optional task input `session:{id,throughSequence}` and scoped earlier-event reads. `ContextAssembler({sessionProvider})` accepts the Session projection through an injected port. Assistant tool calls cannot read beyond their pinned Session snapshot or into another Session. Task execution, cancellation, model pinning and platform allowance still belong to their existing modules. `sessionTools` supplies the same basic create/list/read/append interfaces for MCP or other adapters.

ImmediToday HTTP: `/api/assistant-sessions` GET list/read and POST create; `/api/assistant-sessions/messages` POST append. `/api/assistant-tasks` accepts the explicit Session snapshot and requires a stable idempotency_key for attached tasks. Application teams choose their own interaction flow.

Current scope: single-owner timeline, bounded text, task references and recovery via exact-key replay. Session archive/delete/retention controls, multi-party conversation, automatic summaries, background reference repair and model-independent conversation import are not implemented. Existing tasks remain individually cancellable through Task APIs. Session events are retained as audit data; application developers should not treat this initial adapter as a complete retention policy.

Tests: `test/iaic-sessions.integration.test.js` exercises concurrent/replayed writes, isolation, fixed snapshots, reconstructed state, reference visibility and two tasks across service reconstruction. `examples/core-sessions` runs against an independently installed Core tarball without ERP.

## Message intake lifecycle

`setState(actor,{sessionId,state,requestKey,expectedSequence})` changes open/closed with the same scope, locked sequence and immutable-key replay rules as message append. State changes append `session_state` events; session headers expose the current state. Replaying an old key returns that event and does not undo newer state. A duplicate state under a new key is rejected. Concurrent message/state changes at one expectedSequence have one winner. Existing sessions migrate to open.

Closed means no new user_message events. Existing identical message requests may recover their original receipt. Historical reads and pinned context remain available. Tasks are independent: they may keep using a closed session snapshot, and task_ref receipts may still append so a lost admission acknowledgement can recover. This operation does not cancel tasks, revoke source access, archive data or enforce retention. Applications may separately choose Task admission rules; Core does not create a cross-module transaction.

External personal MCP exposes `my_set_assistant_session_state`; ImmediToday exposes authenticated POST `/api/assistant-sessions/state`. The Assistant's own internal tool catalog does not gain this control. No UI. Deploy all writers with this version before enabling lifecycle operations: old writers do not check closed state. Rollback to an older writer requires stopping session writes until compatible code returns; do not describe an old writer as lifecycle-compatible.

Focused lifecycle coverage lives in `test/iaic-sessions.integration.test.js`, including concurrent state/message changes, old-key replay after reopen, closed snapshot use by an existing Task and independent task-reference recovery. The installed core-sessions example checks close/reopen without ERP or inference.

### Generic resource references (candidate.110)

A trusted Host can append `resource_ref` with `{type,id}`, `expectedSequence:null`
and a stable request key, then query `findEvent(scope,sessionId,requestKey)` after
a lost response. `AssistantSessions({resourceView})` resolves reference data with
current authorization for context assembly; missing/denied data is unavailable.
Raw timeline reads expose only the opaque reference, never a copied private payload.
Enable the expanded event-kind constraint with a compatible initializer; older
initializers must not run once resource references exist. See inbox/README.md.
