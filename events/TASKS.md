# Event subscriptions to Agent tasks

`EventTaskSubscriptions` connects a cursor subscription to existing `DeferredTasks` admission. Use `createAgentDeferredTasks` for ordinary persistent Agent work. This adds no queue, timer, Runtime or business-effect executor.

```js
import {EventTaskSubscriptions, EVENT_SUBSCRIPTION_TASK_PREFIX,
        createAgentDeferredTasks} from '@immedi/iaic-core';
const deferred = createAgentDeferredTasks({
  name: 'assistant.run', store: deferredStore, resolveScope, restoreActor,
  dispatcher, taskStore, sessions,
  reservedPrefixes: ['agent-call:', EVENT_SUBSCRIPTION_TASK_PREFIX]
});
const eventWork = new EventTaskSubscriptions({
  subscriptions, deferred,
  buildTask: async (actor, event) => ({
    goal: 'Prepare the authorized follow-up from the original source event.',
    allowedTools: ['my_read_assistant_event', 'my_write_workspace']
  })
});
// The host owns its loop and polling interval. Each pass is bounded.
await eventWork.tick(actor, {key: 'report-worker', limit: 20});
// Existing workers separately admit and execute the resulting Agent work.
await deferred.tick();
await runtime.tick();
```

Create the subscription first with the desired literal prefix. Configure the target Agent's ordinary event-read capability and source-event restriction (the standard `createAgentTaskCapabilities({events,...})` composition supplies these). The example shows host policy, not a default right to write arbitrary artifacts. See the independent `core-event-agent` example for a complete runnable composition and outcome verifier.

## Source and admission binding

For each event, the stable queue request key hashes the subscription key, original event ID and digest under a reserved prefix. The input pins `sourceEventKey`. A supplied different key is rejected. The due time is the original publication timestamp, making retries stable and eligible for immediate dispatch. The immutable original event remains data, not authority or verified business truth.

The adapter first queries the existing queue receipt. If present, it reuses the original plan and rechecks current Task authorization; changing host plan generation cannot rewrite that intent. For a new event, the trusted `buildTask` port returns JSON Task input and the existing deferred service validates it before storing it. Applications own responsibility, tools, Session/resource references and current policy. Do not turn untrusted event payloads into expanded tool grants.

The deferred service must reserve `EVENT_SUBSCRIPTION_TASK_PREFIX` against ordinary public scheduling. Configure this on all public queue entrypoints sharing the same scope. The composition passes `internal:true` only for its own source-bound keys. It does not grant broader permissions, infer paid-model fallback or change allowance rules.

## Recovery and consumer progress

A source is acknowledged only after the original durable queue intent is available and currently valid. Queue response loss leaves the event unacknowledged; a later pass queries the original receipt instead of replanning or creating another key. Checkpoint response loss may leave the source already acknowledged, while its queue intent continues independently. Concurrent consumers converge on the same immutable intent. Conflicting concurrently generated plans fail the existing input binding rather than replacing the winner.

`tick` returns source/digest/intent metadata in `handled`, the confirmed-through cursor and the page's `hasMore` observation. Errors retain `eventSubscriptionProgress` for operations whose acknowledgements returned; uncertain current operations still require inspecting the original subscription/queue. A return does not assert that queued Tasks or business actions have completed. Existing cancelled or blocked intents remain original records, not implicit permission to recreate them. Repair/retry/cancel use the existing queue and Task lifecycle.

There are no model calls or queue admissions for an empty page. Current authorization applies while reading the source, validating original/new Task input, advancing the subscription and later dispatching/executing the Task. Admission followed by revocation can leave a queued intent and unadvanced cursor; it does not discard evidence or authorize execution under revoked policy.

This foundation covers queue/checkpoint response-loss recovery and service reconstruction with real PostgreSQL and deterministic models. It is not a real-model subscription benchmark, an OS process-kill test, exactly-once business processing, a scheduler daemon or a complete event-retention policy. The host supplies compatible current scope mappings for the subscription and deferred queue and keeps their durable stores. Follow the publisher migration/order contract in SUBSCRIPTIONS.md.
