# Shared request and Token admission rates

`PostgresModelRateLimits({pool,namespace,requestsPerMinute,tokensPerMinute,minimumIntervalMs=0})` supplies an independent PostgreSQL admission rule. Initialize before use. The namespace is a trusted host mapping to a shared provider-account/deployment quota; workers must agree on its configuration. Changing limits silently under an existing namespace rejects. No provider credentials, prompts or model output are stored.

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

## Optional shared request spacing

`minimumIntervalMs` (integer 0–60000, default 0) adds a minimum gap between
admissions in the same trusted namespace. The existing PostgreSQL namespace lock
serializes workers; an independent database timestamp on each receipt carries
spacing across process reconstruction and fixed-minute boundaries. A recent
reserved or settled receipt blocks another admission with the existing
MODEL_RATE_LIMITED / providerNotCalled contract and a database-derived retry delay.
Confirmed non-dispatch removes that receipt from spacing, as with RPM/TPM.

This is admission pacing, not a provider-aware queue or a guaranteed wire-send
interval: process scheduling or downstream capacity waits can move actual send
times. It does not prove unknown work stopped, change any unknown usage hold,
retry a rejected provider call, or enforce other applications' use of the same
provider account. Use the existing concurrency and metering contracts as well.
It does not establish the provider's actual quota or replace TPM accounting.

Schema initialization upgrades old tables without deleting receipts. Existing
namespaces default to zero spacing; legacy receipts receive conservative migration
timestamps. All workers must agree on the persisted spacing configuration; changing
an existing namespace rejects instead of silently changing policy. A host must
coordinate any configuration transition and outstanding work explicitly.

The need was exposed by a real ImmediToday Pro request returning HTTP429 after
three successful calls. Huawei international documentation lists default Pro
RPM3/TPM30000 (checked2026-09-14), but this is not an account quota query:
https://support.huaweicloud.com/intl/zh-cn/model-list-maas/model_list_0001.html .
The tests exercise actual PostgreSQL contention, reconstruction, migration,
non-dispatch billing and controlled timestamp aging. The installed provider-cost
example checks shared spacing too. These are fixtures, not a real-provider fix
verification or completed application quality acceptance.

`rateLimitedModel` also accepts optional `admissionWaitMs` (integer0–60000,
default0). Within that total budget it may wait for a local MODEL_RATE_LIMITED
admission and ask the same rate port again with the original Task/turn. Waiting
honours the request AbortSignal and remains inside the original Runtime inference
deadline. It does not create extra model turns, provider attempts or billing
reservations. A delay beyond the remaining budget returns the existing preflight
rejection. Once a receipt is admitted, the provider executes at most once; provider
errors never enter this waiting loop. This is bounded in-process admission waiting,
not a durable/fair queue, provider retry or automatic Task resumption.
