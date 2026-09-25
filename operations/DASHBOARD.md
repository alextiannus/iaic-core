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
