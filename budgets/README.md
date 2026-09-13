# Shared platform allowance budgets

`AllowanceBudgets` is a separate policy/store module built on the existing TokenLedger account transaction. It does not create a second balance or mint credits. Multiple executor identities may share a ceiling under one explicit payer account. Every reservation must also pass the payer's ordinary available-balance check.

```js
const ledger = new TokenLedger({pool});
await ledger.initialize();
const budgets = new AllowanceBudgets({ledger});
ledger.budgets = budgets;
await budgets.initialize();
await budgets.create(payerScope, {
  id: 'delegation-123', maximum: '1000', executors: ['worker-a', 'worker-b'],
  deadlineAt: '2030-01-01T00:00:00Z', overflow: 'platform_absorbs'
});
// Trusted per-executor model policy, never model-generated arguments:
const policy = {maximum: '100', price: platformRate,
  budget: {id: 'delegation-123', executor: 'worker-a'}};
const model = meteredModel({model: provider, ledger, scope: payerScope, policy});
```

The host must authorize budget creation, participants, payer, model selection and policy binding. These are trusted server ports, not public model tools. An executor ID is an application-issued immutable identity; applications needing multiple identity domains must include their namespace in that ID. The gateway uses the payer scope for billing while its model/credentials may be resolved for another executor by the host. This does not silently select or change credentials. BYOK still reserves/charges zero system allowance and retains actual provider usage.

`create`, `read` and `revoke` operate on one account-scoped immutable budget. Terms include an absolute admission deadline, permitted executors, ceiling and explicit overflow policy. The account lock serializes budget reservations, account balance changes, settlement and revocation. `read` exposes spent, held and available platform units. Unknown and reserved calls retain their full hold until the existing provider reconciliation proves their outcome. Revocation/deadline stops new reservations; already admitted usage can still settle. Budget limits count settled charges plus pending reservations. They are not provider-token or monetary limits.

A provider can report more usage than the call's reserved maximum. To provide a strict platform-charge ceiling without discarding evidence, this module requires the explicit `platform_absorbs` policy: budgeted calls charge at most their reservation, and settlement evidence keeps actual provider usage, ratedCredits, reservationExceeded and platformAbsorbedUnits. This is a configurable host accounting commitment, not an implicit waiver applied to ordinary calls. Non-budgeted calls retain the existing actual-usage/debt behavior. No external provider invoice is reduced by this policy.

An optional `budget` binding is now accepted by TokenLedger.reserve and meteredModel's trusted policy. A budgeted reservation fails closed without its resolver. Binding is pinned on the call and cannot change on replay. Settlement/reconciliation uses that durable binding and does not need a live policy resolver, so revoked work can still be accounted for. Alternative budget adapters must enforce the same explicit overflow policy and account-lock contract before admitting a call.

Initialize the existing ledger first, then this module's schema. The additive ledger migration adds a nullable budget field to existing calls; it changes no historical charges. Modules with no budget configuration continue to work as before.

The PostgreSQL tests cover concurrent executors under one budget, actual usage above a hold without exceeding the configured platform charge, no credit creation, unknown usage across reconstruction, revocation with later settlement, excluded executors and account isolation. This is the budget primitive; cross-principal Task grant binding, artifact sharing, task cancellation and takeover still require integration with collaboration/Runtime. A model policy must not be accepted from the delegated model itself.
