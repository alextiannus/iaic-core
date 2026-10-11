# Platform operator dashboard

`createOperationsDashboard` from `operations/dashboard.js` is an optional Node HTTP
mount over `Operations`, default `/admin/agents`. It provides the packaged page,
CSS/JS and read-only `/api/overview` and `/api/agent?id=...`. Applications retain
their own server, login, session, organizational policy and data adapters. There is
no separately hosted service, new database or Worker.

```js
const dashboard = createOperationsDashboard({
  operations,
  resolveObserver: async request => {
    const session = await currentSession(request);
    return session ? {actor: session.actor, binding: session.visibilityBinding} : null;
  },
  authorizeOperator: async ({actor, request}) =>
    currentOperatorPermission(actor, request),
});
// In the application's existing Node HTTP request handler:
if (await dashboard(request, response)) return;
// Continue other application routes.
```

Both trusted ports are mandatory; there is no built-in role-name inference.
`resolveObserver` authenticates the request using the current Host session and
returns a stable binding of authenticated subject/session, selected organization
and relevant access revision. It must not trust request/model-supplied IDs or a
bare role header. `authorizeOperator` checks a current explicit platform operations
permission and session validity. A personal key, ordinary login or organization
administrator does not automatically qualify. The same gate applies to HTML,
assets and both API routes, before reads and again before sending the response;
a changed binding suppresses the response. Anonymous requests return 401 and
others without the grant return 403. The Host owns login redirects/challenges.

The operator gate supplements Operations' current source/object authorization,
not replaces it. Host ports still filter/redact prior to paging and exclude private
user content without separate permission. Other HTTP/MCP integrations are not
changed or implicitly authorized by mounting this UI. Protect any separately
mounted operations endpoints with their intended explicit access policy.

Only GET is accepted. Responses are no-store with restrictive CSP and no framing.
No CORS grant, credential entry form, browser token storage or control operation is
provided. Dynamic content is rendered through text nodes. Use the normal Host HTTPS
and session lifecycle in an application; the local example is not that system.

## What the page shows

Workspace cards and an equivalent list present the current bounded page. Selection
shows identity/principal, task states and waiting reason, model profile/binding/
requested/actual model, interaction stage/evidence basis, and source freshness.
Next/previous page and refresh use the same Operations contracts. Counts are labelled
current-page, never global counts. Missing actual models and runtime probes remain
unknown; reported review requests are not verified completion. Source errors show
incomplete/unavailable, not a healthy empty system.

The page polls every 30 seconds while visible and refreshes on returning to the tab.
Old requests are aborted and obsolete results ignored. New refreshes clear prior
content; 401/403 clear it and stop polling until page reload. This bounds presentation
staleness but is not push-based instantaneous erasure while idle/offline. Every server
request independently checks current access. Closing the page does not stop Agents.

Detail summaries are bounded by the existing source contracts. Full independently
paged Task traces, navigation into an application's private objects, real external
telemetry and control actions are not part of this version. There is no personal or
organization-admin dashboard variant. Applications can restyle/replace this optional
UI while retaining Core semantics.

## Adoption and rollback

No SQL migration. Mount behind real current sessions/operator permission, wire source
ports and retain the Operations cursor key. Verify anonymous/user/organization-admin
denial, operator scoped reads and revoked access. Remove the mount to roll back;
Task/identity/execution state is unchanged. Candidate.112 support ends
2026-10-10 23:59 UTC upon verified .113 publication.

## Agent management and Skill inventory

The page now includes current-page Agent search and attention/activity/lifecycle
filters, plus a separate Skill inventory. Skill search and pagination cover the
entire **currently authorized** catalog snapshot, independently of the Agent page.
Select an Agent to compare its installed bindings against the supported catalog;
“查看系统全部技能” returns to catalog-only mode. Details expose entry fingerprints,
release version/author when supplied, source, compatibility, license and declared
tools. The export downloads only the displayed page with its scope, completeness,
time and continuation; it is not a full-system export.

Mount the optional, metadata-only service:

```js
import {SkillInventory} from '@immedi/iaic-core/operations/skill-inventory.js';
const skills = new SkillInventory({
  operations,
  cursorKey, // persistent 32 bytes, as for Operations
  listCatalog: async ({actor, scope, signal}) =>
    host.readAuthorizedSupportedSkillSnapshot({actor, scope, signal}),
  readBindings: async ({actor, scope, agent, signal}) =>
    host.readAgentSkillBindings({actor, scope, agent, signal}),
});
// Add `skills` to the existing createOperationsDashboard options.
```

The Host must authorize the `skills` operation in the same Operations scope policy
and filter catalog/bindings by current visibility before returning them. A system
catalog is not the operator's own selected SkillCatalog: using the latter would
silently omit other supported Skills. `SkillCatalog.list(trustedContext)` supplies
compatible metadata for a host-registered supported catalog. No entry bodies,
scripts, filesystem paths outside the registered IDs, or arbitrary metadata are
projected. Only public `author` / `version` metadata keys are displayed.

Both ports return `{items, complete, observedAt, validUntil}`. Catalog items require
`id`, `name`, `description`, `version` and optionally `format`, `source`, `license`,
`compatibility`, `allowed-tools`, `metadata`. Bindings require `id`,
`installedVersion`, `enabled`, `readiness` (`ready|blocked|unknown`) and `reason`.
The Host owns installation records, version pins, dependency/permission checks and
freshness. A selected entry alone does not prove installation or runnable tools.
`ready` is a Host preflight observation, not proof of successful execution; only
report it after current checks. The UI does not execute tests against business
systems to infer readiness.

Absent installation is `false` only for a complete, fresh bindings snapshot;
otherwise it is unknown. Disabled bindings are blocked. Stale evidence and installed
entries missing from the visible catalog remain unknown. Different fingerprints
are labelled version differences, never automatically “newer” or safe updates.
Counts describe the authorized snapshot and carry its completeness, not global
system totals. A failed source produces an error, never a successful empty catalog.
Ports have cancellable timeouts and a 10,000-record snapshot ceiling; larger hosts
must introduce a paged source adapter rather than silently truncate or label partial
snapshots complete. Responses are paged at 1–50 items, default 20.

`GET /api/skills` accepts `agentId`, `query`, `status`, `limit`, `cursor`. Without an
Agent only status `all` is valid. Continuations are encrypted and bound to the
current authorization scope, Agent, query, filter, page size and snapshot revision.
A changed snapshot invalidates the cursor; the UI returns to page one. Ports must
provide stable public metadata and stable ordering of any semantically ordered
values. Every response is reauthorized before delivery, including catalog-only
reads. The existing dashboard session gate also covers the endpoint. No mutation
is added: install/enable/update remain owned by the Host's approved configuration
workflow and cannot grant capabilities through this inventory.

Without a `skills` port, the page explicitly reports that the catalog is not
connected. Existing dashboard mounts, feedback and Operations source contracts
remain compatible; there is no database migration or new runtime dependency.

Design references verified 2026-10-12: [Agent Skills specification](https://agentskills.io/specification)
for portable metadata and progressive loading; [MCP tool annotations](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/)
for the distinction between descriptive hints and enforced authorization.

Local verification: `node --test test/iaic-skill-inventory.test.js test/iaic-operations-dashboard.test.js`.
A runnable, explicitly fixture-only example is in `examples/core-skill-management`.

Review hardening for candidate.119: a requested Agent must return a valid bindings
snapshot (null/undefined are errors), and its object-level permission is checked
again after both source reads in addition to the Skill operation permission.
Revocation clears Agent headings, cached rows, exports and feedback drafts; failed
roster refreshes cannot be undone by client-side filtering. Returning to the tab
revalidates both the roster and Skill inventory immediately.
