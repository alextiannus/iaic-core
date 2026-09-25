# Recipient Inbox

Optional `@immedi/iaic-core/inbox/{service,store,capabilities}.js` module. It is a
recipient read model, independent of Notifications Outbox, Conversation and Task.
No provider, business schema, model, background executor or application UI is required.

```js
const store = new PostgresInboxStore({pool, namespace: 'my-application'});
await store.initialize();
const inbox = new Inbox({store, resolveScope, authorize, resolveProjection});
```

`resolveScope(actor)` must use trusted Host identity and bind **all** isolation
axes needed by the application (Principal, Tenant, Workspace, Market, application).
Do not use request/model-supplied identity or an ambiguous concatenation. Use a
canonical tuple or a Host scope ID. AccountDirectory/current membership and personal
credential checks stay in the Host `authorize` port. The same authorized recipient
Actor is required for receive/read/mutate/project. Producers need explicit Host
permission to receive on the recipient's behalf; receive is intentionally absent
from the model capability catalog. Store methods are trusted infrastructure ports,
not authenticated public APIs.

`receive(actor, {requestKey, notificationId, title, summary, category, priority,
relatedObjectRef?, actionRef?})` creates an immutable source record once. Changing
content under the same key is a 409. References are opaque strings, never a grant
or URL to private data. The fixed scope identifies the recipient. Each created
record has a stable UUID, sequence cursor, version and independent timestamps.
`deliveredAt` means the Inbox record exists, not that a provider delivered, a user
read, or a business action completed. Source Outbox and business facts stay separate.

`list(actor, {before?, limit?, archived?})` returns retained title metadata only,
plus global active unread count and the next cursor. No summary or object/action
reference is exposed in list. Page and count use one database snapshot; insertion
is serialized per scope so a late commit cannot disappear behind a cursor.
Concurrent state changes may alter later pages; this is a live list, not an export
snapshot. `unreadCount`, `get`, `markRead`, `markUnread`, `archive`, `history` are
available. Archive changes visibility and leaves all source records and audit intact.

`authorize(actor, {action, item?})` must explicitly return true. Scope authorization
runs first; detail, state changes and projection also check the item. Policies may
retain old titles/counts (`list`) while denying private detail (`read`). If retained
titles are not appropriate, deny the scope list as well. This minimal API does not
implement per-item title redaction. Mutations also require current detail permission
and return the authorized item. Any more restrictive domain action must still check
its own current permissions, Entitlements and Mandate at execution time.

## Projection and recovery

`project(actor, itemId, {kind: 'conversation' | 'task'})` uses the immutable item ID
as conversation key and immutable `actionRef` as Task key. Ordinary notifications
cannot create a Task. An action key cannot bind to a different item in the same
scope. The Host should reuse the source notification for repeated delivery of the
same action; a new revision requiring new work needs a distinct action reference.
A client cannot choose fresh keys to bypass deduplication. Separate kinds have
separate stable projection UUIDs, passed to adapters as `idempotencyKey`.

`resolveProjection(actor, {kind,item})` supplies `send({idempotencyKey,item})` and
`query({idempotencyKey,item})`. Both return `{status:'delivered', reference}`,
`{status:'not_sent'}` or `{status:'unknown'}`. The Host adapter must enforce persistent
idempotency and validate the immutable source/context binding. For Tasks, admit
through the existing Runtime with current authorization and the trusted context;
for conversations, append a reference, not a copied permanently authorized payload.
The service never executes the business action itself.

The claim is durable before sending. Exceptions/malformed receipts become unknown;
expired sending claims become unknown on the next project call. Unknown calls query
without sending. Retry happens only on a later explicit call after proven not_sent,
using the same projection UUID. **An absent row is not proof of non-send** if an
original request might still commit. Query must repair any Host-owned Task/context
binding before reporting delivered. Do not use Core's claim lease as an external
effect fence: adapters must deduplicate the stable key even with a delayed sender.
No background retry loop is installed. The Host can call project from its own worker.
History records claims, expired claims and settled results; receipt fields are
restricted to status/reference, not arbitrary adapter payloads.

## Capability and conversation composition

`createInboxCapabilities({inbox})` supplies `inbox.list/get/unread_count/mark_read/
mark_unread/archive/history/project`. The service always authorizes the recipient;
Host discovery/admission must filter the catalog for its authenticated Actor. A
trusted Host handles receive separately. State-changing capabilities use never-replay;
application callers explicitly recover/reconcile through the module API.

SessionStore now supports neutral `resource_ref` events with `{type,id}` and stable
request keys, plus scoped `findEvent`. AssistantSessions accepts `resourceView` to
resolve each reference with current access. Missing/denied references become
unavailable, not a cached sensitive summary. No Inbox dependency is added to Sessions.
See `examples/core-inbox` for a runnable Host composition and minimal optional UI.

## Migration, lifetime and rollback

Candidate.110 adds `inbox/schema.sql` (three optional tables/index) and expands the
Sessions event-kind constraint to allow `resource_ref`. Initialize with a compatible
Host during controlled migration; older SessionStore initializers narrow that
constraint and must not run after resource references are enabled. Back up first.
Do not mix old and new session initializers. Existing event rows remain unchanged.

To roll back, stop the Inbox routes/projectors and new Session consumers; retain
Inbox/projection/audit records and reconcile unknown external effects under their
original stable IDs. Do not drop evidence or remove references to make old schema
initialization pass. A Host using resource_ref must remain on the compatible session
reader until it has an explicit preservation/migration path. Candidate.109's support
ends 2026-10-09 23:59 UTC after candidate.110 publication.

Limits: no per-item retained-title policy, provider channels, retention purge,
read receipts from IM, real-model UI acceptance, or generic cross-store durable-wake
binding adapter. Host/application integration is separate from Core publication.
