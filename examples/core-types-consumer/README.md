# Strict TypeScript consumer

Run `npm run verify:types-package` from the installed/source Core package with npm available. The gate creates an independent tarball consumer and executes the compiled `consumer.mts`; it does not rely on the source checkout's module declarations.

For application code, import `defineCapability` and `CapabilityDispatcher` from `@immedi/iaic-core/capabilities/index.js`, the Fetch handler from `@immedi/iaic-core/http/server.js`, and the client from `@immedi/iaic-core/http/client.js`. See [the exact typed scope](../../capabilities/TYPES.md). This example supplies its own business types and synthetic Task admission port; it does not introduce business types into Core or claim full AgentRuntime/Peer/root declaration coverage.
