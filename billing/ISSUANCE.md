# Platform allowance issuance

`AllowanceIssuer({ledger, authorize, resolveSource}).issue(actor, {sourceId})` is the headless issuance contract. The host authorizes the issuer before resolving a source. Its trusted adapter returns `{sourceId, confirmed:true, scope, amount, evidence}` from a platform allocation, subscription or confirmed payment. Claimant/model input does not select amount or recipient. An unconfirmed source produces no credit.

`TokenLedger.issue` atomically binds the source ID within the application to one recipient, amount and evidence, and creates its grant entry. Repeating the same source is idempotent; changing its recipient or facts returns 409. The source binding and ledger entry commit together. `grant` remains a low-level per-account primitive for existing internal callers; new externally sourced issuance should use `AllowanceIssuer`/`issue` to obtain application-wide source binding. These methods are not user/model tools.

AssistantModels requires a configured platform policy for system-managed calls. Missing policies fail with ALLOWANCE_POLICY_REQUIRED; missing per-profile rules also stop calls. BYOK still uses zero platform debit and never falls back silently. The ImmediToday adapter turns legacy global system-model configuration into a standard profile too, so omitting a profile list does not bypass allowance handling. Low-level provider/Runtime primitives remain composable; hosts integrating them directly must supply the appropriate accounting wrapper.

A policy has `maximum` reservation and immutable `price: {revision,input,cachedInput,output}` in platform credit units. These are application allowance conversion coefficients, not supplier currency prices or a declaration that platform credits equal provider tokens. The ledger retains normalized and raw usage independently. Reservations can require a top-up before the account reaches literal zero, because the next bounded call must be covered. Confirmed top-up does not automatically change task intent or replay work: resume the existing task, or explicitly switch it to a user-owned model through the model/task contracts.

ImmediToday's trusted operator CLI is `scripts/issue-assistant-allowance.mjs <allocation.json>`, with DATABASE_URL and IAIC_ALLOWANCE_OPERATOR set in an administrative environment. Database credential access is the authority; the operator name is an audit label. It accepts platform allocations only, not an unverified claim that a payment succeeded. The operator supplies the correct ERP recipient mapping. Example receipt shape (fixture values):

```json
{"kind":"platform-allocation","applicationId":"immeditoday","sourceId":"platform:unique-allocation-id","employeeId":"verified-employee-id","erpUser":"verified-user@example.test","amount":"40","reason":"Authorized platform allocation"}
```

Keep the allocation source, recipient, amount, reason and operator stable on retry. A payment provider adapter must verify its own source and derive the recipient/product amount before calling the Core contract. Product prices, checkout UI, refund workflows and automatic subscription grants are application work or later integrations; none are fabricated by this CLI. This release does not issue production allowance or configure commercial rates.

Focused verification: `test/iaic-allowance-issuance.integration.test.js` covers concurrent issuance, owner/evidence changes, unconfirmed sources, operator CLI replay, missing-policy rejection, and an actual persistent Assistant pausing before any provider call, pausing again after partial work and completing after a second issuance without repeating its document write. Existing BYOK checks confirm zero debit after the stricter system policy rule.
