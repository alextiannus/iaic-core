# Durable Task wake

`TaskWake` is an optional trusted Host harness over the existing Notifications
Outbox. It fixes the gap where a Core Task commits but an application-owned
Task/Assistant Context link or acknowledgement fails. It adds no queue, Task
executor, model, business schema, or automatic transfer of Principal authority.

## Immutable intent

`enqueue(actor, {requestKey, intent})` checks Host `authorizeEnqueue`, validates the
owned topic, and persists a canonical immutable intent in the existing source JSON:

- topic, explicit target `{scopeId,subjectId}`;
- `context`: existing HostBinding reference, revision, digest and owner;
- capability, stable taskRequestKey, exact JSON input;
- minimal authorityRef (a reference to the applicable mandate/policy revision).

The context must belong to the target. `resolveScope(target)` must include the
application's complete Principal/Tenant/Workspace/Market identity; the referenced
immutable Host snapshot must preserve those semantics. No current selection from
an interactive browser or model response is consulted later. The enqueueing Actor
and target may differ only when Host policy explicitly permits scheduling for that
target. Merely naming a topic, Principal or authorityRef grants nothing.

The Host owns immutable snapshot storage and current authorization. Core validates
the stored digest syntax and exact returned Task binding; the existing HostTaskContext
or equivalent Host check must verify the actual snapshot digest and current access.
Task keys are explicit, persisted once, and reused across every attempt. Occupied
keys with different input, owner, capability or context fail closed.

## Host ports

`authorizeSend(intent)` checks current account, Context, role, membership,
Entitlement, mandate, capability and any expiry before admission. `admitTask` receives
`{intent,idempotencyKey,signal}` and should use the existing Runtime/Host admission
path with the exact trusted Context, not invoke a business operation directly.
Return the actual Task receipt normalized as `{id,request_key,capability,input,
trusted_context,owner}`. With TaskStore, `owner` comes from its trusted actor codec.
The fixture uses TaskStore directly only to isolate this failure window.

`authorizeReconcile(intent, taskOrNull)` is an independent **historical receipt and
binding repair** policy. Null means scoped receipt inspection; a Task means repair
of its already admitted binding. It can permit repair after new-send authority is
revoked, but it never grants fresh admission or restores the revoked role. The
Task's eventual execution still requires current Runtime/Host authorization.

`findTask({intent,idempotencyKey})` returns:

- `{status:'found',task}`: real scoped TaskStore receipt;
- `{status:'unknown'}`: absent/ambiguous result or possible in-flight commit;
- `{status:'not_sent',evidenceRef}`: Host proof that no original admission can still
  commit. An empty query alone is **not** that proof. Evidence retention/fencing is
  the Host's responsibility; a string supplied by an untrusted caller is no proof.

`repairBinding({intent,task,idempotencyKey})` must idempotently upsert/verify the
application's missing link under current reconciliation permission, then return
`{bound:true,reference}`. Core verifies Task owner, request key, capability, exact
input and HostBinding before calling it. A conflict, missing link, lost reply or
unverified result remains unknown. Never overwrite a conflicting link. Return
`delivered` only when both Task receipt and binding are verified; delivered is not
Task execution success or business completion.

## Recovery and isolation

`pump({after?,limit?,signal?})` processes one bounded page of this harness's dedicated
channel (limit 1..100; default 20). Persist/continue the returned `next` cursor until
null, then begin a new pass. New arrivals behind a cursor are processed next pass.
Do not keep restarting at the first page; doing so can starve later records.
Use a distinct channel per consumer and explicitly configure its owned `topics`.
Unknown topics are reported as recovery errors and remain unacknowledged. Another
channel is never claimed or recovered by this harness.

Every record is isolated with its own error result so one poison record does not
abort the page or suppress its next cursor. Results expose only job IDs/status and
a generic recovery error, not private adapter exception text. Operators inspect
original persisted notification attempts and Host evidence to diagnose failures.
This harness installs no scheduler; the Host owns bounded scheduling/backoff.

A durable claim precedes admission. Thrown admission/binding results and expired
worker leases become unknown. Unknown recovery only queries and repairs; it never
calls admitTask. A proven not_sent becomes failed, and only a later pump retries
with the original Task key after rechecking current send permission. Automatic
attempts are bounded (default 3, configurable 1..10). Unauthorized or exhausted
records are retained for explicit Host handling. Task admission itself must remain
idempotent even if a sender continues after its queue lease expires. Core does not
claim distributed exactly-once or an external admission fencing mechanism.

Notifications now accepts optional `channel`/`id` claim filters, a channel filter
for expired-lease recovery, and a trusted `recoveryPage` store method. Existing
unfiltered Notifications consumers retain their behavior; do not run an unfiltered
sender against channels dedicated to this harness. The app must enforce worker
ownership when sharing an Outbox namespace.

## Example, migration and limits

See `examples/core-task-wake/run.mjs`. It commits a real Core Task, injects failure
before an application SQL link is written, reconstructs the harness, revokes new
admission permission, and repairs the original link with one admission. No model,
production database, scheduler or business action is involved.

Candidate.111 adds no SQL migration. Candidate.110 Inbox remains an independent
recipient model; its read/unread/archive semantics are not reused as wake state.
To adopt, wire all Host ports and a dedicated channel, then rerun the failure-window
fixture with the real adapter before scheduling. Pause the wake worker on rollback;
retain intents, original Task keys, unknown attempts, Context snapshots and links.
Older generic senders must not consume the dedicated wake channel. Candidate.110
support ends 2026-10-09 23:59 UTC after verified candidate.111 publication.
