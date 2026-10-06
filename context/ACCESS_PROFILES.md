# Versioned Access Profile reconciliation

`AccessProfileReconciler` is an optional deterministic Host migration harness.
It does not infer grants from a Capability catalog, a role name, a deployed version,
or a conversation. The Host explicitly selects Context IDs, defines versioned
profiles and approves an immutable diff. This module owns no database or scheduler.

```js
import {AccessProfileReconciler} from '@immedi/iaic-core/context/access-profiles.js';
const migration = new AccessProfileReconciler(hostPorts);
const plan = await migration.preview(operator, {
  profile: {id: 'application.reader', version: '2'},
  contextIds: selectedContextIds
});
// Present/store plan; the application's authorized approver records plan.digest.
const result = await migration.apply(operator, {plan, approvalId});
```

## Data and authority

A profile contains `id`, `version`, `permissions` and `mandates`. Mandates are
opaque references, not permission names or new delegation documents. The Host
validates their issuer, scope, delegation chain, expiry and current availability;
this harness never extends a Mandate. Profile versions must be immutable.

`readContext` returns the current `contextId`, opaque `revision`, `policyRevision`,
`identity` (`scopeId`, `principalId`, `role`, `market`), original `profile`,
`overrides` (`grant`/`revoke` each containing permissions and mandates), `effective`,
`denied`, and `eligible: true`. Ineligible Contexts fail preview. Selection and
eligibility are application policy, not inferred from identical roles. Use an
explicit neutral market label where the Host has no market dimension.

The target effective set is `(target profile ∪ extra grants) − extra revokes −
current denials`, independently for permissions and Mandates. Core preserves the
identity and overrides. Preview includes the entire expected snapshot, target
profile, proposed revision data, add/retain/remove sets and a SHA-256 digest.
Up to 100 distinct Context IDs and 500 entries per set are allowed; plans are
bounded to 1 MiB. Inputs and plans must be plain JSON. No data changes on preview.

The required trusted ports are:

| Port | Host obligation |
| --- | --- |
| `authorize({actor,action,contextId})` | Current operator authority, visibility and scope for preview/apply. Return exactly true only when allowed. |
| `resolveProfile({actor,profile})` | Resolve the exact immutable ID/version from an authorized source. |
| `readContext({actor,contextId})` | Read current state and calculate eligibility and denials, including currently revoked/expired Mandates. |
| `approve({actor,approvalId,digest})` | Validate an existing explicit approval bound to this exact digest, operator, scope, expiry and current revocation. This method checks approval; it must not create approval automatically. |
| `readReceipt({actor,contextId,operationKey})` | Query the original durable operation, scoped to the authorized operator. Null means no known receipt, not proof no commit can occur. |
| `appendRevision(request)` | Atomically revalidate authority, approval, eligibility, immutable profile and expected Context/policy; append a new revision, audit and unique operation receipt, or commit nothing. |

`appendRevision` receives actor, Context ID, stable operationKey, planDigest,
approvalId, `expected` full snapshot and `next` identity/profile/overrides/effective.
Its transaction must lock or otherwise fence policy and approval changes as well
as Context revisions. Preflight checks in Core do not eliminate this commit race.
It must return the same receipt for a repeated key, reject key/content mismatches,
and never overwrite history. Receipt fields are Context ID, operationKey,
planDigest, previousRevision and new revision. The Host owns revision numbering.
Do not adapt this port to separate, non-atomic grant and audit writes.

## Recovery, batches and rollback

Persist the plan and approval before execution. Recreate the service and replay
the same plan after interruption. Core checks the original receipt before comparing
the current revision; a committed write with a lost acknowledgement is recoverable.
An unconfirmed result is `unknown`, not success or failure. Never replace its key
to force a retry. The Host must reconcile asynchronous writes and serialize
competing attempts using that key and compare-and-swap.

Each result is `applied`, `unchanged`, `blocked` or `unknown`; `complete` requires
every entry to be applied/unchanged. Other entries proceed after a per-Context
failure. A bad or expired batch approval rejects the call. For more than 100
Contexts, the Host persists and approves separate bounded plans. This is not
all-or-nothing across Contexts, and it is not a persistent Core job queue.

For rollback, preview an explicitly selected prior profile version against the
**current** Context and policy, obtain a new approval, then append a compensating
revision. Never restore a whole old snapshot or erase current revocations. A
successful historical receipt proves that operation committed, not that those
grants remain usable now. Keep approval readable for authorized recovery; current
operator revocation must still deny recovery reads.

Old Tasks retain their original `HostTaskContext` binding and snapshot. Migration
does not rewrite Tasks. Current Host authorization must check each subsequent
action, so revocation can deny execution even while historical bindings remain.
New commercial privileges require a new authorized context/action; an old Task
must not silently acquire the new profile. Catalog visibility is checked separately
with `checkAccessCatalogMatrix`; a catalog is never a grant source.

## Evidence and adoption

`examples/core-access-profiles` is an isolated PostgreSQL **application adapter**
using fictional profiles, approvals, immutable revisions and audit receipts. It
demonstrates partial recovery, original HostTaskContext projection, current denial
and catalog matrix composition. The tests cover lost acknowledgements, concurrent
attempts, revision/eligibility/policy changes and compensating rollback. Its simple
operator flag and fixed profiles are fixture policy, not production identity or
approval services. The fixture Task is a Host binding, not a full running Agent.

The application must implement and test its transaction, current-policy fencing,
selection and approval UI/API, migration scheduling and execution checks. No
production users are migrated by installing this package. No application adoption,
production migration, or full execution matrix is claimed. Roll back the package
by removing this optional composition; already committed application revisions
remain and require approved compensation if they must change.
