# Executor drain and deployment handoff

Candidate.99 adds host-only, database-backed executor generations and drain
requests. It keeps the dedicated PostgreSQL session advisory lock as the exclusive
owner. There is no time-based lease stealing: a deadline is not evidence that an
old executor died. Core does not call Render, terminate another instance or change
application readiness endpoints.

## Rolling hosts

After validating the new host's configuration, initialize it once with
`await runtime.initialize({requestHandoff:true})` and start its poll loop with
`runtime.start()`. This requests draining of the observed generation, then tries
the existing exclusive session lock. Default initialization does not request a
handoff. For separately initialized hosts, the trusted equivalent is:

```js
const current = await store.executorState();
if (current.generation !== null) {
  await store.requestExecutorDrain({generation: current.generation});
}
```

Do this once as an intentional deployment operation, not on each health probe,
user request or standby tick. A stale generation request returns false. Never
expose these ports as User Assistant tools or unauthenticated HTTP actions.

A drain request and the next Task claim serialize on one ownership row. Work
claimed before the request is already in flight; it may finish its original
bounded Runtime turn/task budget and account for admitted effects. No subsequent
Task can be claimed by that draining generation. On the next completed tick the
old Runtime releases the lock and retires permanently; it cannot reacquire it.
The new Runtime's normal polling acquires the lock, increments the generation,
and only then recovers genuinely abandoned running Tasks. All TaskExecutor
transactions check the generation/token; lost session/ownership rejects new
prepare, dispatch and model-request admissions. This does not supply fencing to
an external Provider that does not accept a fencing token. Already admitted
external effects remain governed by their original receipts and unknown rules.

`runtime.deploymentState()` projects acceptingTicks, ownsExecutor, this instance's
generation, observed ownership `{generation,state}`, and requiresTermination.
This is a point-in-time host diagnostic, not an authorization token. Historical
`runtime.ready` means **executor ownership**, not HTTP readiness. A healthy new
web host may accept and persist authenticated Tasks while waiting for ownership.
Host liveness can report that its process/event loop is alive; readiness should
check the host's configuration, database and admission services. Do not require
unique executor ownership before HTTP readiness or the orchestrator can deadlock
waiting for the new host before terminating the old one. A fully retired host
should be removed from routing by its supervisor.

## SIGTERM / bounded shutdown

The application stops its other admission schedulers and owns process termination.
A typical host handler (install once) is:

```js
process.once('SIGTERM', async () => {
  stopAcceptingNewRequests(); // host-owned listener/scheduler shutdown
  const outcome = await runtime.drain({timeoutMs: 25000});
  // drain never unlocks while its tick remains in flight.
  // Process exit is what ends remaining work and releases the DB session.
  process.exit(outcome.drained ? 0 : 1);
});
```

`drain` retires the local loop immediately. It waits at most timeoutMs (0..300000)
for the currently running tick after the database drain request completes. Configure
bounded pool/network timeouts as well. On timeout it returns
`{drained:false,requiresTermination:true}` and **keeps the executor lock**. The
supervisor must then terminate this process within its grace period. There is no
safe way for Core to declare a still-running remote action dead. On ordinary
completion it closes the session and returns drained:true. `stop()` remains an
unbounded cooperative shutdown and now also retires the loop before waiting.
Neither method can be used to restart the same Runtime; construct a new instance.

## Accounting and installation

An unknown model call remains reserved/unknown across takeover. Use the existing
`UsageReconciler` with a host-authenticated provider export/evidence resolver;
[installed reference](../examples/core-usage-reconciliation/README.md) shows the
original request identity and idempotent source. `providerAccepted:false` requires
positive non-acceptance evidence; timeout/HTTP status/admin intent is insufficient.
This release does not reconcile live usage or synthesize zero-token settlements.

Migration017 adds one ownership row per Task schema; Task schemas/actors keep
existing semantics. The first upgrade from .98 or older needs a controlled stop of
old executors: old binaries do not honor drain requests or generation checks.
After all participating hosts use .99, the handoff protocol applies. Maintain
original Task host versions; a code/Skill mismatch remains paused. Do not deploy
older executors against the shared schema during this protocol.

## Evidence and scope

`test/iaic-executor-handoff.integration.test.js` runs two real PostgreSQL Runtime
instances at four barriers: before model invocation, Provider accepted, measured
usage returned before ledger settlement, and a dispatched tool write. It verifies
no premature recovery, no new old-instance claim, one original write, and settled
accounting. A real child process receives SIGTERM, reaches the drain deadline,
exits, and is recovered with its original reserved model usage intact. Existing
session-loss tests preserve unknown tool writes and block blind resume.

[Independent runnable composition](../examples/core-executor-handoff/README.md)
is tested from the packed package. Provider/tool bodies are deterministic fixtures;
this does not certify Render rollout timing, third-party cancellation or actual
provider-export retrieval. The application must configure its grace period, health
routes and trusted usage resolver, then perform its own deployment acceptance.
