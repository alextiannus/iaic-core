# Shared request and Token admission rates

`PostgresModelRateLimits({pool,namespace,requestsPerMinute,tokensPerMinute})` supplies an independent PostgreSQL admission rule. Initialize before use. The namespace is a trusted host mapping to a shared provider-account/deployment quota; workers must agree on its configuration. Changing limits silently under an existing namespace rejects. No provider credentials, prompts or model output are stored.

Each database-clock fixed calendar minute has both a request count and a provider-Token budget. An accepted call consumes one request and reserves a host-supplied maximum input+output Token count. Admission is serialized with settlement under the same namespace lock. It returns a durable UUID tied to original Task/turn. A duplicate Task/turn cannot be admitted in a later window or after a terminal receipt. A new Task is not permission to evade an unresolved original operation.

```js
const gateway = meteredModel({
  model: rateLimitedModel({
    model: capacityModel({model: provider, capacity}),
    rates,
    maximumTokens: request => trustedTokenUpperBound(request),
  }),
  ledger, scope, policy,
});
```

The trusted maximumTokens callback returns a positive safe integer no greater than the configured Token limit. It must include the actual assembled input and the provider's output bound, not the Task's platform allowance. Core does not supply a universal model tokenizer. Cached input remains part of input Tokens; reasoning/output detail fields are subsets and are not added again. Host configuration must reflect the provider's accounting policy when using another estimator. These rules do not change model/credential mode, route or account.

The wrapper runs inside the existing per-model metered gateway and outside the concurrency wrapper. A rate rejection has MODEL_RATE_LIMITED, providerStatus 429, providerNotCalled and database-derived retryAfterMs until the next window. Existing bounded Runtime waiting rules apply; no queue or fallback is added. Capacity/credential preflight failures explicitly marked providerNotCalled release rate request/Token reservation and platform allowance. A normal response or error with valid input/output usage replaces reserved Tokens with actual input+output usage, while still counting one request. Explicit non-dispatch removes both request and Token consumption. Errors without usage leave the reservation; no inferred zero use.

`finish(id,{actualTokens,evidence})` or `finish(id,{notCalled:true,evidence})` is a trusted internal reconciliation port, not a user/Agent assertion endpoint. Resolve the original provider receipt and authorize any operator-facing exposure. The first terminal usage/evidence is immutable: repeated same usage returns it, conflicting usage rejects. Actual usage above the bound is recorded honestly and blocks additional admissions in that window as needed; it cannot retroactively prevent usage already incurred. Hosts must supply conservative bounds. A lost settlement acknowledgement preserves the returned model result/usage with rate.settlementConfirmed=false, so ordinary billing can still settle its own evidence. It does not trigger another provider call. get(id) exposes the original internal reservation for reconciliation.

## Window and lifecycle limits

This is a local fixed-minute admission budget, not a reproduction of every supplier's rolling/RPM/TPM algorithm. Minute boundaries can permit bursts. Reservations/usage are attributed to their original admission window even when the response arrives later. Old-window reservations stop contributing to the next rate window, but remain persisted as reserved/settled/not-called; this is NOT proof that an outstanding provider stopped. Independent concurrency capacity continues to hold unknown in-flight work until terminal evidence, and the platform ledger separately protects unresolved usage. Provider-imposed 429s still apply.

No adaptive vendor-header synchronization, rolling window, distributed fair queue, automatic health detection, dynamic limit migration, automatic reservation pruning or public trusted-provider reconciliation adapter is included. Rate Tokens, platform allowance units, concurrency slots and currency cost remain distinct. Tests use actual PostgreSQL concurrency and reconstructed adapters; controlled window aging is a test fixture, not waiting for a real supplier reset or a process-kill proof. The independently installed provider-cost example composes rates, capacity, metering and AgentRuntime with deterministic usage. No real provider was called for these checks.
