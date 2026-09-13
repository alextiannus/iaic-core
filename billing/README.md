# Billing module

This module owns platform allowance accounting and the model-call admission/settlement rules. It does not own payment UX, subscription products, page layouts or provider currency pricing. Platform Token allowance is distinct from actual provider tokens.

Read only these files for ordinary billing changes:

- `token-ledger.js` and `schema.sql`: account projection, grants, reservations, immutable settlement, unknown-use holds, paged entries.
- `metered-model.js`: wraps a provider's `next(request)` method; pre-reserves, settles measured usage, pauses unresolved attempts. BYOK has zero platform debit.
- `issuer.js` and `ISSUANCE.md`: trusted-source allowance issuance and its administrative integration.
- `wallet.js`: authenticated read contract and tool descriptor; returns balances, paged public entries and pending holds. Internal evidence is omitted.

Dependencies are explicit constructor arguments: a PostgreSQL pool for the ledger, a provider/ledger/account/policy for metering, and a `resolveScope(actor)` function for wallet reads. Billing imports no application service, ERP client, web server or UI. The application supplies a trusted account and policy; untrusted request bodies never choose the account or grant credits.

`WalletReader.read(actor, {before})` returns `{balance, entries, pending, nextCursor}`. Entries use descending ID pagination, up to 50 per page; pending contains the latest 50 unresolved calls, while balance includes every reservation. Reads may reflect intervening live transactions; refresh to reconcile the display. It is a read contract, not a settlement transaction.

ImmediToday composition is a constructor/delegating method in `src/ai-native/service.js` and a thin HTTP transport in `src/http-server.js`. Ordinary accounting and wallet rule changes belong here; those files need editing only when public registration changes. Application developers own the UI and may consume HTTP, MCP or the ESM class directly.

Focused verification: `node --test test/iaic-wallet.test.js test/iaic-token-ledger.integration.test.js` with `SUBMISSION_TEST_DATABASE_URL` pointing to the isolated test PostgreSQL instance. `test/ai-native-service.integration.test.js` checks application wiring. Do not introduce a dependency injection framework or cross-module service lookup to add a rule.

`reconciliation.js` adds trusted-source reconciliation of an original unresolved model request. See `RECONCILIATION.md` for measured use, definitive non-acceptance, immutable source binding, operator CLI and unchanged Task resume rules. It uses ledger ports only; no Task-table, ERP, provider SDK or UI dependency.

`taskUsage(scope,taskId)` reads scoped settled provider tokens and charged platform units separately, with request/pending counts and completeness. It exposes no raw ledger evidence and does not compute currency cost. The observation module consumes this port without querying billing tables itself.


The optional costBasis admission snapshot and costCalls projection support the independent costs module. Provider currency estimates remain separate from platform allowance and do not add monetary charges; see costs/README.md.


The providerNotCalled release evidence is now named provider-preflight to cover both credential and capacity admission checks. Optional capacityModel belongs inside meteredModel; see ../agent/CAPACITY.md. Busy capacity does not debit platform allowance, and capacity/usage reconciliation remain independent.

When a provider error has no measured usage, metering preserves a bounded
`diagnostic` in the unknown ledger entry and on the reconciliation error. It
contains the original internal request ID, an enumerated failure kind, and any
valid HTTP status, Retry-After duration (at most one day) or explicit completion
boolean reported by the provider adapter. Raw messages, headers, response bodies,
credentials and arbitrary provider fields are excluded. The shared contract is
`agent/usage-diagnostic.js`; Runtime projects the same validated metadata into the
failed `model_usage` event so authenticated Task history can explain the hold.

This is diagnostic context, not proof of zero usage or non-acceptance. Even a
reported HTTP 429 retains the original hold until existing reconciliation policy
has authoritative evidence. The diagnostic is nested and does not trigger the
Runtime's unmetered-provider retry path. Older unknown entries cannot recover
provider information that was discarded at the time. If a timeout wins before
metering returns, its later ledger evidence remains authoritative for the hold;
no new Task event is promised after the Task's original timeout transition.
