# Local platform operator dashboard

This example reads a real isolated PostgreSQL TaskStore through Operations and
mounts the packaged default UI on loopback. Directory, model profile and reported
Review request are labelled Host fixtures. No live Worker or external Connector is
probed; both Agents' health is unknown and the actual model is unreported. The Task
remains queued. This is not a deployed 12Eat/production monitor.

Run with Node 20 and an isolated database:

```
SUBMISSION_TEST_DATABASE_URL=postgresql://... node examples/core-operations-dashboard/run.mjs
SUBMISSION_TEST_DATABASE_URL=postgresql://... node examples/core-operations-dashboard/serve.mjs
```

The first command automatically verifies HTTP page/assets/API, real Task queries,
ordinary user and organization-admin denial, and revocation. It does not launch a
browser. The second prints a loopback URL and generated fixture-only Basic password;
open the URL using username `operator`. Use `user` or `organization-admin` with the
same fixture password to inspect denial. Stop with Ctrl-C to remove the fixture schema.

Never expose this fixture server to a network or reuse its demo credential logic in
an application. Replace resolveObserver/authorizeOperator with real current sessions
and explicit platform operator grants. Keep Operations' separate per-object checks.
See operations/DASHBOARD.md for the reusable mount contract and limits.

A local Chrome check also exercised selection, actual Task model binding versus
unknown actual model, list switching, 375px layout without horizontal overflow,
and clearing the page after operator access was revoked. See `evidence/result.json`,
`evidence/dashboard.png` and `evidence/mobile.png`. These are local fixture evidence,
not production health or real external-agent acceptance.

To repeat the optional browser check, install puppeteer-core in a separate tooling
project and set `IAIC_BROWSER_HOST_PACKAGE` to its package.json,
`IAIC_BROWSER_EXECUTABLE` to Chrome, `IAIC_BROWSER_EVIDENCE` to a fresh directory,
and `SUBMISSION_TEST_DATABASE_URL` to a local isolated PostgreSQL database. Run
`node examples/core-operations-dashboard/browser.mjs`. Browser tooling is not a Core
runtime dependency or an implicit production check.
