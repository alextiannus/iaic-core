# Agent and Skill management preview

Run `node examples/core-skill-management/server.mjs` from Core, then open
http://127.0.0.1:4319/admin/agents. Set `PORT` to change the local port.

This binds only to loopback. Its two Agent identities, installation bindings and
operator session are fixtures. Skill metadata is loaded from real registered
example packages through `SkillCatalog`; no model or business API is called.
Do not mount its permissive demo authentication in a deployed application.

Check system catalog, select 研究助手, filter installed/blocked/version differences,
expand version/source/dependencies, search by ID or description, export the current
page and switch back to the system catalog. Existing task/model/health details are
retained. No telemetry is simulated as healthy or executed successfully.

See `operations/DASHBOARD.md` for the production Host adapter contract. Framework
implementation and local validation do not mean that an application's installed
Core version or production mount has been upgraded.

## Retained verification

Validated 2026-10-12:

- Complete Core module suite: 492 tests passed, zero skipped, using Node 20 and a new isolated PostgreSQL database.
- `npm run verify:types-package`: passed tarball consumer compilation/execution and PostgreSQL consumer tests; zero Core/consumer type diagnostics. The script explicitly tolerates its two pre-existing MCP SDK exact-optional diagnostics.
- New inventory tests cover incomplete/stale records, duplicate IDs, source timeout, missing catalog entries, public metadata projection, global search, pagination scope/snapshot binding and revoked authorization.
- HTTP tests cover optional mounting, query ambiguity, hidden Agents and revoked responses.
- Browser checks cover system/Agent views, blocked filtering, search, JSON download, Agent filtering, desktop/mobile layout, revocation clearing both panels and zero browser errors.

Screenshots: [desktop](evidence/desktop.png), [mobile](evidence/mobile.png). These are local fixture previews, not production evidence.

Reproduce the browser checks against the running demo with
`node examples/core-skill-management/browser.mjs` when Playwright is installed.
`PLAYWRIGHT_MODULE` may point to an existing Playwright module, `CHROMIUM_PATH` to
an installed browser, `PREVIEW_URL` to the local demo URL, and `SCREENSHOT_DIR` to
an output directory. The script downloads only its own local test export.
- `scripts/verify-examples.mjs`: complete example regression passed against the isolated PostgreSQL database using Node 20, after updating the existing dashboard example's title assertion.

## Review and release validation (2026-10-12)

Review found and fixed an Agent-specific revocation window after source reads,
invalid null binding snapshots being marked complete, retained Agent labels and
cached rows after errors/revocation, and missing immediate Skill revalidation on
returning to the tab. Timestamp types are now checked before parsing. Added
regressions passed; the complete module suite now passes 495 tests. The browser
script also verifies failed-roster cache suppression, foreground revalidation and
heading/export clearing. Candidate.119 adds no Runtime or database migration.
