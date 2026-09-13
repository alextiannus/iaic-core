# Cursor subscriptions

`EventStore.list(scope,{after:'0',prefix:'',limit:50})` supplies a bounded feed over the existing immutable events. `PostgresEventSubscriptions` owns a separate checkpoint table; `EventSubscriptions` supplies current authorization and composes the two adapters. It does not create another Agent scheduler, infer business outcomes or require a message broker.

```js
import {EventStore, PostgresEventSubscriptions, EventSubscriptions,
        createEventSubscriptionCapabilities} from '@immedi/iaic-core';
const events = new EventStore({pool});
const checkpoints = new PostgresEventSubscriptions({pool});
await events.initialize();
await checkpoints.initialize();
const subscriptions = new EventSubscriptions({
  store: checkpoints, events,
  resolveScope: actor => currentEventScope(actor),
  authorize: (actor, request) => currentSubscriptionPolicy(actor, request.operation)
});
await subscriptions.subscribe(actor, {key: 'report-worker', prefix: 'report:'});
const page = await subscriptions.read(actor, {key: 'report-worker', limit: 20});
// Process each event through currently authorized domain capabilities, using
// its original id/digest to reconcile any uncertain effects before advancing.
await subscriptions.acknowledge(actor, {
  key: page.key, expectedCursor: page.cursor, cursor: page.nextCursor
});
const capabilities = createEventSubscriptionCapabilities({subscriptions});
```

Register those ordinary capabilities in an existing dispatcher to use its SDK, HTTP, MCP or A2A surface. Subscribe and acknowledge require stable write call IDs at the dispatcher. Read and write history projections recheck current access without recreating a subscription or advancing its checkpoint. The host owns the worker/poll interval and domain processing; an external Agent can read the same feed without adopting Core Runtime.

## Delivery and progress

A subscription key permanently binds a literal event-key prefix within one application/assistant/subject scope. Empty prefix includes all keys in that scope. It begins at cursor `0`, including previously published events. Reusing the key with a different prefix conflicts. Each consumer uses its own key. Prefixes are routing filters, not authorization; the current scope/policy determines access.

Read returns `{key,prefix,cursor,items,nextCursor,hasMore}`. Every item retains the original event receipt and adds a bigint-string `sequence`. Reading does not advance progress. After service reconstruction, unacknowledged events can be read again; new matching events appear in subsequent reads. Pages are live bounded queries, not immutable batch snapshots. Cursor values are strings to avoid JavaScript integer precision loss.

Acknowledgement advances only from the expected checkpoint, and its target must occur within the first 100 matching events after that cursor (or equal the expected cursor for a no-op). Concurrent advancement never rewinds. If a checkpoint is already at or beyond an acknowledged position, the same acknowledgement returns confirmation through the requested cursor; this describes current progress, not a unique receipt proving the original acknowledgement operation ran. A conflicting intermediate position requires reading current progress. Different prefix/scope events and nonexistent future cursors cannot advance the checkpoint.

The caller decides whether processing is complete before acknowledging. A checkpoint is **not** proof of a business effect, successful Task, payment or new authority. A crash after an external action and before acknowledgement can redeliver that event. Consumers must reconcile the original domain operation, not blindly repeat it. No exclusive consumer lease, exactly-once processing claim, automatic Task creation, wildcard language or push/streaming transport is provided.

## Publication order and migration

Event initialization adds a bigint identity sequence and feed indexes. Existing events keep their original IDs, keys, data, source, digests and publication times; backfill assigns a stable enumeration without claiming historical clock ordering. Initialize before enabling new cursor consumers. The migration requires PostgreSQL DDL locks; applications own rollout timing.

All publishers for a cursor feed must use the upgraded `EventStore.publish` adapter (including signed ingress). It holds a scope-specific transaction advisory lock **before** allocating the sequence and releases it at commit. A later publisher in the same scope cannot expose a larger sequence while an earlier one is still uncommitted. Different scopes may publish independently; sequence gaps and cross-scope allocation order do not signal missing events. Direct SQL writes or concurrently running older publishers that bypass this coordination are outside the feed contract; do not enable cursor consumption until those writers are migrated/quiesced.

Default storage adapters share a host PostgreSQL database; alternate adapters supply equivalent committed-order `list`, scoped subscription and atomic monotonic checkpoint contracts. Raw storage methods are trusted internal ports, not public Agent tools. There is no automatic event/checkpoint retention, deletion, quota enforcement or archival. Page size is 1–100; hosts should choose a smaller page for large event bodies to fit their Runtime context/output budgets.

PostgreSQL checks cover actual overlapping publication transactions, legacy backfill, service reconstruction, prefix/owner isolation, concurrent acknowledgements, digest checks and current revocation. The independent installed core-events example composes signed ingress with these subscription capabilities. These are deterministic fixtures, not a production broker load test or real-model subscription acceptance.
