# Shared model concurrency capacity

`PostgresModelCapacity({pool,namespace,maxConcurrent})` provides one persistent concurrency pool shared by workers. Initialize it before use. The host maps a provider account, deployment or other quota boundary to a stable namespace and chooses the same maxConcurrent (1–10,000) for every worker. Configuration mismatches reject rather than silently changing the pool. This initial configuration is immutable through this API; quota changes/migration require explicit host coordination and must preserve active reservations.

`capacityModel({model,capacity})` wraps the existing provider next(request) interface. It preserves model/profile/credential metadata and requires the Runtime's billingContext taskId/turn. The store serializes admission per pool, counts active reservations and persists a unique original Task-turn receipt before provider dispatch. Full capacity rejects with MODEL_CAPACITY_BUSY, providerStatus 429 and providerNotCalled; existing Runtime bounded retry/wait rules apply. An already admitted Task turn cannot be replayed, even after its slot is released. A different pool key is a different quota domain, not permission to evade a prior unknown request.

Compose in this order:

```js
const boundedProvider = capacityModel({ model: provider, capacity });
const gateway = meteredModel({ model: boundedProvider, ledger, scope, policy });
```

The outer gateway retains current model/allowance policy. A capacity rejection releases its temporary ledger reservation as provider preflight, with no provider call or platform debit. BYOK retains its existing zero-platform-debit rule. Do not wrap an entire metered gateway as the provider: the wrapper should measure actual provider request lifetime, not infer it from a usage-reconciliation error. A host may supply the bounded provider through existing ModelProfiles/UserModels factories without changing the shared Runtime or introducing another model router.

A resolved provider next() promise is this adapter contract's terminal response and releases the slot. Pre-dispatch cancellation and an explicit providerNotCalled error also release it. Other errors, including transport loss or timeout, retain the slot; no expiry timer guesses that the provider stopped generating. If the provider returns but release acknowledgement fails, the response retains its usage/result and adds capacity:{reservationId,releaseConfirmed:false}; the conservative persisted hold is reconciled separately. Capacity cleanup failure does not justify another provider request. Provider adapters must resolve next() only after the request has completed, not upon receiving an open stream.

## Inspection and reconciliation

The trusted store exposes get(id) and bounded pending({after,limit}) over its namespace. Rows contain original Task/turn and lifecycle evidence, not prompts, credentials or model responses. They are internal operator ports; the host must authorize any user-facing exposure. Raw release(id,evidence) is also trusted internal code, used only after confirmed completion/non-dispatch.

`ModelCapacityReconciliation({capacity,resolveSource,authorize})` adds a current-authorized operator boundary. resolve(actor,{reservationId,sourceId}) asks the host to verify the original provider request, requiring matching sourceId/reservationId/namespace, confirmedTerminal:true, and outcome not-started or finished. It rechecks authorization before release. Caller-provided elapsed time, a local process exit, cancellation request or missing response is not terminal provider evidence. Source verification is a trusted integration contract; this module does not invent vendor completion APIs. First release evidence remains immutable on later release calls.

An actual SIGKILL test proves admission survives the worker and blocks new admission until the injected trusted receipt confirms terminal state. This test does not contact a real provider or prove the provider request lifetime after a network failure. A separate integration composes the real allowance ledger and verifies busy admission has zero provider calls/debit. The installed cost example uses the same AgentRuntime with capacity and metering together.

## Boundaries

Concurrency slots are distinct from platform allowance, provider Tokens, currency cost, per-minute rates and delegated budgets. Capacity reconciliation does not settle unknown usage or grant allowance; usage reconciliation does not prove an uncertain provider stopped and release capacity. Operators may need both independent confirmations. There is no alternate-model fallback, account swapping, distributed waiting queue, RPM/TPM limiter, fairness scheduler, automatic orphan reset or vendor terminal-receipt implementation. Crashed pre-dispatch reservations can remain conservatively active until verified. This provides the default shared concurrency rule, not complete provider capacity management or full Note 30 acceptance.
