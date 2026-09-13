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
