# Memory module

The module owns persistent memories, optimistic revisions, forgetting and active-memory export. It provides basic rules and contracts; applications own UI/UX and identity/source mapping. It does not treat user statements as verified business facts.

Read `service.js`, `store.js`, `schema.sql` and `tools.js` for memory work. `AssistantMemory` receives `store`, trusted `resolveScope(actor)` and `sourceFor(actor)` ports. The store receives a PostgreSQL pool. No module file imports ERP, model settings, the application service or web server. Tool descriptions/schemas live here so changing a memory contract does not require searching the central platform file.

Public operations are `list`, `read`, `remember`, `forget`, `relearn`, `dispute`, `resolveDispute`, `export` and `import`. Every service operation resolves the current authenticated scope. Application-provided source labels override untrusted input. Writes require the current revision; forgetting erases content/source and retains a tombstone so stale writes cannot restore it.

`export(actor)` returns `{format:'iaic.memory.export.v1', exportedAt, memories}`. A single SQL statement snapshots all active rows in the account, ordered by key, preserving content, kind, source, revision and timestamps. It excludes expired rows, disputed rows and forgotten tombstones. It does not export task history, business records or unrelated Workspace/Knowledge data. The v1 synchronous export supports at most 1,000 memories and 8 MB of record JSON; larger snapshots return 413 without a partial result. Background/streaming transfer and destructive restore/merge are not implemented.

ImmediToday exposes `GET /api/assistant-memories/export` and personal MCP `my_export_assistant_memories` through this same module, alongside the existing read/write/forget contracts. HTTP/MCP are thin application adapters; no export page was added.

Focused tests: `node --test test/iaic-memory-service.test.js test/iaic-memory.integration.test.js`. The integration test requires isolated PostgreSQL via `SUBMISSION_TEST_DATABASE_URL`. Tests cover non-ERP identity and source injection, full active export beyond list limits, deletion/expiry/partition isolation and explicit over-limit rejection. The broader app tests cover context consumption and existing HTTP/MCP wiring.

Remaining complete-memory capabilities include working/session versus long-term layers, organization sharing, confidence/conflict management, knowledge links, automatic extraction, and propagating source correction/deletion into derived results. Do not call this module complete memory lifecycle management yet.


`import(actor,{requestKey,snapshot})` accepts a v1 export, including the direct SDK result of `export`. It imports at most 1,000 records / 8 MB record JSON in one PostgreSQL transaction. A duplicate key inside the snapshot is invalid. Any collision with an existing, expired or forgotten local key aborts the entire import; this operation never overwrites or resurrects an existing key. Records already expired at transaction time are explicitly listed in skippedExpired instead of being imported.

Imported rows start at local revision 1. Their source is `user-import`, with trusted importedBy metadata supplied by the host, exportedAt, claimedSource and originalRevision. Claims in the file do not grant permission or turn user memories into authoritative facts. Scope/owner fields in the file cannot choose the destination account. Original storage timestamps are not restored. Wrapped source metadata must fit the normal memory source size limit; an oversized source aborts the batch.

The same requestKey and normalized snapshot return the original content-free receipt, even after a later edit, expiration or forgetting. This receipt proves what that import created at the time, not current memory availability. A changed snapshot conflicts. Metadata object ordering and row ordering do not change import identity. `iaic_memory_imports` stores only the request digest, keys/revisions, skipped keys and timestamp, not a second copy of imported content or source. `forget` clears the imported row's content and source; it does not erase separate Task audit inputs, Session events, exported files or application audit records.

ImmediToday exposes POST `/api/assistant-memories/import` and MCP `my_import_assistant_memories` through the same service. This is a write capability requiring explicit inclusion in an Assistant Task's allowedTools. No import UI, model invocation, platform charge, automatic extraction or conflict-resolution wizard is added. To merge or replace an existing key, the caller must use the ordinary explicit revision-based remember operation after reviewing the current value.

Tests: `test/iaic-memory-import.integration.test.js` covers cross-account SDK export/import, authoritative destination/source, atomic rollback, concurrent replay/conflicts, expiry, forgotten keys and write classification. The installed `examples/core-notes` checks migration and replay after forgetting. Organization sharing, conflict/confidence reasoning and broader lifecycle capabilities remain unfinished.


`read(actor,{key})` reads one exact key. It returns key, current revision, kind, status, expiration and update time. Active records include content/source; expired and forgotten records return null content/source. Missing or other-account keys return 404. This avoids exporting all memories to locate a revision and permits a current-revision update of an expired record. List/export still include active rows only. Model history revalidates an exact-key read and drops its former content after forgetting/expiry.

`relearn(actor,{key,kind,content,expectedRevision,expiresAt?})` explicitly writes newly supplied user content to an existing forgotten key. The expected revision must match the current tombstone. Revision increases monotonically and the host supplies a new source label; erased content/source cannot be recovered. Relearn cannot modify an active record, and a stale replay cannot override a later edit, forgetting or relearning. Ordinary remember and import retain their existing no-resurrection rules. This is a separate write capability requiring explicit allowedTools inclusion; the model should use it only when the user explicitly supplies a new statement for the forgotten key.

HTTP: GET `/api/assistant-memories?key=...`, POST `/api/assistant-memories/relearn`. MCP: `my_read_assistant_memory`, `my_relearn_assistant_memory`. Core provides state/transition rules, without a recovery UI or deleted-content archive. This is not a complete retention policy across Task/Session/export copies.

Focused tests: `test/iaic-memory-key-lifecycle.integration.test.js`, including inactive-content omission, current-revision expiry edits, concurrent/stale relearning, read-history revalidation, and old import replay after a new statement. The independent notes example checks this lifecycle across an installed package.

## Disputed statements and explicit correction

`dispute(actor,{key,reason,expectedRevision})` marks one active memory as contested with a bounded user-supplied reason and trusted host source label. The revision increments atomically. Default list/automatic memory injection and active-memory export exclude it. `list(actor,{status:'disputed',query?,limit?})` explicitly discovers unresolved statements; default status remains active. This is an explicit review state, not semantic conflict detection or a numerical confidence score.

Exact read shows status disputed, the original statement/source and the dispute reason/source while unexpired. The separate disputed boolean preserves metadata if the record expires, while expired content/source/reason remain hidden. Tool history revalidates current status; disputed text is a contested claim, never a settled business fact. The host source label cannot be replaced by caller input.

`resolveDispute(actor,{key,kind,content,expectedRevision,expiresAt?})` accepts newly supplied user content only for a disputed record at its current revision, clears the dispute and increments revision. It does not certify factual truth. Ordinary remember cannot override a dispute. Stale concurrent edits conflict; unknown write responses require an exact-key read, not blind replay. Forget clears both statement and dispute text/source; resolve cannot resurrect tombstones. Broader copies in Task/Session/audit/export history remain outside this module's erasure contract.

Both operations are writes requiring explicit Assistant allowedTools inclusion. Internal write results contain only key/revision. HTTP POST `/api/assistant-memories/dispute` and `/resolve-dispute`, GET with `status=disputed`, and corresponding personal MCP tools use the same service. No UI or model call is required. Install compatible readers/writers before marking production memories disputed: older readers include these rows in automatic retrieval. Rollback must stop memory reads/writes or retain compatible filtering.

Focused tests: `test/iaic-memory-disputes.integration.test.js` covers default exclusion, explicit discovery, on-demand history refresh, source injection, revision races, expiry metadata and forgetting. The independently installed notes example demonstrates dispute/correction. Organization sharing, automatic extraction, confidence reasoning and propagation into derived resources remain open.

## Current memory versus old call arguments

`memoryTools` owns history-input projections for remember, relearn, dispute/correction, import and list. Historical writes retain identifiers/revisions and omit content/reason/snapshot; historical list calls omit query text. Assistant capability composition forwards this optional descriptor hook to Context. No model/ERP dependency is added to Memory, and no UI or database migration is needed. Models obtain content from current authorized read/list/export results, not from a copied old write payload.

This prevents forgotten, expired or superseded memory text from being automatically reintroduced through these tool-call arguments. Raw Task audit inputs are intentionally retained for existing recovery/verification; original goals, user input, Session logs and external exports are separate stores. No global erasure or removal from all historical artifacts is claimed. Deploy the compatible Context reader with the Memory descriptors; reverting to a reader without projection restores its older argument-display behavior.

Regression first reproduced on PostgreSQL: after remember/list/read/forget, the following model input still contained the forgotten marker from prior call arguments. The focused tests now check the complete Runtime path plus correction, disputed reason removal, expiry, import, failed/unknown argument projection and unchanged original audit data. The independently installed Core Assistant example also exercises forgetting and projection.
