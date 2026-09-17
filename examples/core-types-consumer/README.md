# Strict TypeScript consumer

Set an isolated `SUBMISSION_TEST_DATABASE_URL` and run `npm run verify:types-package` from the installed/source Core package with npm available. The gate creates an independent tarball consumer and executes the compiled `consumer.mts` and `starter.mts`; it does not rely on the source checkout's module declarations. It also compiles a copied `app.mjs`/`app.d.mts` pair as used by the scaffolder.

`starter.mts` covers the real ordinary Agent composition: pg.Pool compatibility,
Host context and rich Actor restoration, task wait/rebuild/continuation, revocation,
historical function-result revalidation and metered settlement. Negative compile
cases reject business-only Actor assumptions, wrong Task inputs and unsafe use of
undeclared raw service handles. The fixture model and synthetic write make no
production or real-provider claims. See the starter README for the intentionally
bounded declaration scope and remaining optional extension types.

For application code, import `defineCapability` and `CapabilityDispatcher` from `@immedi/iaic-core/capabilities/index.js`, the Fetch handler from `@immedi/iaic-core/http/server.js`, and the client from `@immedi/iaic-core/http/client.js`. See [the exact typed scope](../../capabilities/TYPES.md). This example supplies its own business types and synthetic Task admission port; it does not introduce business types into Core or claim full AgentRuntime/Peer/root declaration coverage.
