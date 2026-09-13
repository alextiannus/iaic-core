# Provider currency cost estimates

ProviderCostAccounting is a read-only cost projection, separate from platform-issued allowance, actual provider token counts and payment/refund services. It calculates usage-rate estimates; it does not debit money, grant credits, create an invoice or assert a supplier's final bill.

The model gateway accepts optional trusted `policy.costBasis`:

```js
{
  format: 'iaic.provider-cost.v1', revision: 'your-rate-card-revision',
  currency: 'USD', minorUnitScale: 2,
  bearer: 'platform', accountReference: 'opaque-provider-account-reference',
  model: 'the-provider-model-id',
  inputPerMillionMinor: '300',
  cachedInputPerMillionMinor: '30',
  outputPerMillionMinor: '1200',
  missingCachedInput: 'incomplete'
}
```

These numbers illustrate the schema and are not current prices for any provider. Rates are nonnegative decimal-string currency minor units (up to six decimal places) per one million provider tokens. The host must supply current applicable rates, the currency's correct scale, provider account attribution and a matching model identity. Currency codes are format-checked, not looked up; Core performs no exchange-rate conversion or provider-price scraping. For SYSTEM_MANAGED the bearer is platform; for BYOK it is user. An account reference is an opaque attribution identifier, never an API key.

meteredModel validates and snapshots this basis before any provider call. TokenLedger reserve stores it atomically with the existing admission record and rejects a reused request key with changed cost metadata. Currency rating is not part of allowance settlement: the original platform conversion coefficients, budgets, overflow rules and BYOK zero platform fee remain unchanged. Model/provider errors with confirmed usage still have cost; unknown usage is not assigned zero. Reconciliation uses the original admission basis and original measured-usage receipt, not today's price configuration. A new rate requires a new configured gateway/basis revision for later calls.

`new ProviderCostAccounting({ledger}).task(trustedBillingScope,taskId)` reads the ledger's scoped costCalls port. Its output includes completeness counters, exact grouped totals and content-free source receipts. The PostgreSQL projection reads at most 1,000 calls from a coherent SQL statement; larger Tasks return 413. It returns only normalized token counts, status, admission price metadata and settlement references, not prompts, responses, provider raw payloads or API credentials. Alternate usage stores can implement the same port without transferring their ownership.

Input tokens include cached input; the estimator subtracts cached input before applying the uncached rate. Output already includes reasoning tokens and is not charged twice. `missingCachedInput:'incomplete'` leaves cost incomplete if cache usage is absent and the two input rates differ. An explicit `uncached` policy instead makes a labelled uncached-use estimate; equal input rates do not require a cache split.

Amounts retain an integer minorUnitsNumerator, with denominator 1,000,000,000,000 relative to the configured currency minor unit. The fixed denominator preserves six decimals in a per-million-token price without floating-point arithmetic. Totals group by currency, minor scale, cost bearer and provider-account reference. minorUnitsCeiling rounds only the grouped Task total upward; use the exact fractional value for accrual/reporting where possible. This prevents rounding every tiny inference to a full cent. The result is still a rate-card estimate: discounts, taxes, request fees, other token classes, subscription commitments and supplier invoice adjustments are not implemented by this calculator.

Pending reservations/unknown results, settled records without pricing, or incomplete cache measurements make complete false. Confirmed non-accepted/released calls have no token-based cost. An empty Task has no cost sources; a caller must also establish that no model requests are missing before interpreting that as zero work. Mixed currencies remain distinct totals, not a synthetic sum. Missing prices are never backfilled using an arbitrary current rate.

## Task observation integration

createTaskObservationSource accepts optional `costForTask({context,task,usage,request})`. This is a trusted application port; the observation module imports no cost calculator. Return a selected `{currency,minorUnits,kind:'usage_rate_estimate'}` projection, or null to defer the observation when cost is incomplete. The host must select the intended cost bearer/account and a compatible currency/scale for its observation policy. Leaving the port unconfigured preserves observations without currency cost. Labelled estimates can inform an explicit cost policy but must not be presented as invoiced money.

The independent core-provider-cost example runs the existing AgentRuntime, settles provider usage and platform units, reconstructs the cost projection, and supplies an estimated amount to the existing Task observation source. Five PostgreSQL integration checks cover fractional aggregation, sub-minor-unit prices, price immutability, BYOK attribution, cache uncertainty, unknown-usage reconciliation, missing prices and mixed currencies. All rates and models are fixtures; no real money is charged and no real-model quality claim is made.
