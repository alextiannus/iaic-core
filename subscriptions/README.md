# Subscriptions and entitlements

This independent module owns the current subscription binding and its effective entitlements. It does not own invoices, payment processing, spendable platform allowance, provider Tokens or application UI. Subscription products are host-configured data rather than industry-specific plans built into Core.

## Ports and default implementation

- `PlanCatalog(plans)` registers immutable `(id, version)` entries with `entitlements`: named booleans, nonnegative numbers or strings. Register a new version to change a plan. Reads return copies. Persist/distribute the catalog in the host's configuration system; existing subscriptions retain their own plan snapshot.
- `PostgresSubscriptionStore({pool, namespace})` provides `initialize()`, `get(scopeId)` and `apply(sourceSnapshot)`. A replacement store must preserve namespace/scope isolation, revision checks, monotonic source ordering and atomic source deduplication with state updates.
- `Subscriptions({store, plans, resolveScope, authorize, resolveSource, now?})` exposes `read(actor)`, `require(actor, name, {atLeast?})` and `apply(actor, {sourceId, expectedRevision})`. Scope and authorization are resolved on every operation. The host can call `AccountDirectory.current(actor)` from these ports to enforce current account/membership state.
- `createSubscriptionCapabilities({subscriptions, prefix?})` exposes read/apply through the shared Dispatcher, HTTP, MCP and Runtime. Reads support current history revalidation. Capability apply is idempotent by the trusted source identity; a transport call ID does not replace that identity.

One current subscription exists per host-selected scope. A user, company or product-specific subscription can have its own scope. This does not require foreign keys to the accounts module or ownership of business data.

## Confirmed sources and ordering

`resolveSource(sourceId,{actor,scopeId})` must return a trusted record:

```js
{
  sourceId, scopeId, confirmed: true,
  sequence: 1,                 // strictly increases within this subscription scope
  state: 'active',             // active | paused | cancelled
  planId: 'basic', planVersion: '1',
  validFrom: '2030-01-01T00:00:00Z',
  validUntil: '2030-02-01T00:00:00Z'
}
```

The caller cannot set plan, owner, sequence or period through the Capability input. The resolver verifies authoritative provider/administrative facts and retains the evidence referenced by sourceId. Raw webhook arrival order is not a source sequence: adapters must establish current authoritative ordering or reconcile before applying. A source is immutable; corrections use a new source and higher sequence.

`expectedRevision: 0` creates. Later updates need the current revision. Repeating the same source and facts returns its original receipt with `replayed: true`, even after later updates; it never reinstalls the old state. Changed facts under the same source or unseen older sequence are rejected. Read current state separately from historical receipts. A transaction commits both source receipt and new state or neither.

## Effective access and composition

Access is effective only when state is active and `validFrom <= now < validUntil`. No expiry worker is required. Paused/cancelled states disable current entitlements immediately. Period-end cancellation can leave the current period active and omit renewal; future changes can be applied by the existing scheduling module when due. This store represents the current binding, not a queue of future plan transitions or multiple overlapping subscription items.

`require(actor,'feature')` requires boolean true. `{atLeast: n}` checks a numeric entitlement. Numeric values are declared limits, not usage reservations; the authoritative resource/quota service must enforce actual consumption and concurrency. String entitlements are available from read for explicit host policy. Recheck at the operation boundary; reading a subscription does not grant a permanent execution lease or undo completed effects.

Applying a subscription never grants or debits a wallet. `examples/core-subscriptions` separately composes the existing `AllowanceIssuer` with a host-confirmed allocation policy and stable source ID, proving that repeated issuance does not double-grant. Platform allowance remains platform-issued units; it is not provider Tokens or currency. Subscription updates and ledger issuance are independent durable operations that the host can reconcile. Refunds, billing amounts, taxes, seats, proration and payment adapter workflows remain separate work.

Focused evidence: `test/iaic-subscriptions.integration.test.js` covers persistence, replay after later changes, stale sources, revision races, scope binding, renewal, expiration, cancellation and pinned plan versions. The example uses isolated PostgreSQL and fixture facts, not a live payment or model provider.
