# Capability MCP adapter

`createCapabilityMcpServer({dispatcher,resolveAccess,serverInfo?})` returns an unconnected MCP SDK Server. The host owns transport, authentication, token/OAuth policy, audit and disposal. Import `@immedi/iaic-core/mcp/server.js` and install the optional peer `@modelcontextprotocol/sdk` (^1.30.0, tested at 1.30.0). The root Core export never imports the SDK; applications without MCP keep using the base package.

`resolveAccess(extra)` runs on every tools/list and tools/call and must return a trusted `{actor,capabilities:[names]}`. There is no fallback to exposing the registry. The host authenticates transport/request context, not model arguments. Discovery exposes only this current list; actual execution also calls the original CapabilityDispatcher, including its schema, current authorization, verification and domain rules. This resolver is a visibility ceiling, not a permission grant. Clients may cache old discovery; calls still check current access. The first adapter returns a single catalog page and does not send list-change notifications.

All tools use a simple transport envelope: `arguments:{input:<unchanged business input>,requestKey?:string}`. A stable nonempty requestKey (at most 200 characters) is mandatory for writes and for Agent task admission, including read-labelled Agents. Business validation occurs on input, without the transport key. This is intentionally exposed in the tool schema so ordinary MCP Agent clients can supply it. Local JSON Schema references are preserved by giving an otherwise anonymous nested business-input schema its own resource ID. Object, array and scalar business inputs are supported.

Function results remain the original JSON value in text content; object results additionally use structuredContent, with the original object output schema. Array/scalar outputs omit MCP's object-only outputSchema. Agent tools return the existing durable Task admission receipt, not the final business output, so they do not advertise that final schema as the immediate result. The host exposes appropriate Task read/control capabilities separately. MCP task-augmented execution is a different protocol and is not implemented here.

The adapter passes requestKey as callId. Domain services own idempotency and reconciliation; the adapter does not persist a second operation ledger or automatically retry writes. A stable key alone is not an exactly-once guarantee. Unknown outcomes retain their flag and request key, with reconciliation guidance. Potentially uncertain Agent admission failures are also reported conservatively. Internal server-error messages are withheld by default; hosts retain their own logs/audit. Read-only/idempotency hints reflect the capability effect and retry declaration; they are not authorization.

ImmediToday selects this surface on its existing authenticated POST /mcp resource with `X-IAiC-Surface: capabilities`. Existing Bearer/OAuth authentication and audit remain application-owned. The exported set is assistant.run plus its existing tools, gated to the current pilot/account. The normal personal MCP interface remains available without this header, including existing Task control/model/account tools not yet expressed as dispatcher capabilities. Revoking a transport credential prevents future requests; already admitted durable Tasks retain their own account/Mandate/cancellation rules.

No UI, new Runtime, business registry or credentials are introduced. Full protocol parity, server catalog pagination/notifications, A2A and complete Task protocol support remain open. Focused tests: test/iaic-mcp.test.js. examples/core-mcp installs the package and runs real MCP transport with PostgreSQL-backed domain idempotency and the existing Task Runtime, without ERP; its deterministic model proves wiring, not model quality.

## Import external tools

`discoverMcpTools(client, {signal?, maxPages?})` discovers a connected MCP server's paginated tool catalog. `importMcpCapabilities({client, resolveClient, bindings, signal?})` turns selected tools into ordinary deterministic Capability adapters. Import from `@immedi/iaic-core/mcp/client.js`. The importer itself is duck-typed and does not load the optional SDK; the host supplies connected clients.

Each binding supplies `name` (local), `tool` (remote), `effect` and `authorize`. Only explicitly bound tools become capabilities. Remote annotations do not grant permission or determine effect/retry rules. `resolveClient({actor, signal, callId, tool, capability})` chooses the current authenticated connection for each execution; Core does not install arbitrary remote servers, start processes, or accept model-provided credentials.

By default input is the remote input schema and arguments pass through unchanged. Output retains MCP `content` and optional `structuredContent` rather than assuming every tool returns plain text or a domain result. A remote `isError` throws; the host can inspect `error.remoteResult`, and the Dispatcher preserves uncertain write outcomes. There is no automatic replay.

Writes default to `never-replay`. An explicitly idempotent binding must provide `input` and `toArguments(input, context)` to map the stable `context.callId` into the remote service's actual idempotency contract. This does not prove remote deduplication; the host must choose a service that implements it. Optional `verify(input, result, context)` checks domain outcomes. `examples/core-mcp-import` demonstrates importing Core's MCP envelope and remote domain deduplication.

Import is a contract snapshot used when composing a registry. Refresh/re-register explicitly when changing a remote catalog; this is not hot installation during a running task. Schemas must be supported by Core's existing strict Ajv compiler; incompatible schemas fail import rather than silently losing validation. Connections, OAuth/token rotation, resource/prompt methods, remote task protocols and notifications remain host responsibilities or future adapters.

## Keep Agent admission consistent across entrypoints

If the application wraps Agent admission with Session association, readiness checks or reserved internal request keys, supply a dispatcher facade whose `invoke(name,input,context)` routes that Agent through the same admission function. Keep `capabilities` equal to the underlying registry so discovery/schema semantics remain unchanged. Forward `context.signal` and `context.allowedCapabilities`; preserve business input validation before translating the transport key into application fields. Deterministic functions continue through the original Dispatcher. The MCP adapter does not infer application lifecycle rules or install a second Task path.

ImmediToday's `assistant.run` now uses `createAssistantTask`, matching the ordinary HTTP/personal-tool entrypoint. A shared requestKey returns the same Task and repairs/retains one Session reference. External calls cannot use `deferred:` or `iaic-handoff:` internal Task keys; an `idempotency_key` inside business input remains invalid rather than being silently stripped during envelope translation.

`examples/core-configurable-jobs` shows an external MCP client reading the configured job's Workspace and Skills without invoking a hosted model, and optionally admitting durable work through the shared Session-aware entry. It reads Task status and the resulting artifact through the same capabilities. The example host's actor comes from its trusted scope mapping; an external Agent does not need Core Runtime internally. This demonstrates selected capability parity, not complete protocol feature coverage. The explicit importer is described above.

## Lark integration

The optional [Lark bridge](../channels/LARK.md) selects 89 reviewed official MCP tools across eight domains, including joining groups and managing members. It uses this importer and the same Dispatcher; the provider server remains an application dependency. Import `@immedi/iaic-core/mcp/lark.js`.

## Typed server and HTTP connection (candidate.103)

The server subpath now exports `McpAccessContext`, `McpAccess<A>` and a typed
`createCapabilityMcpServer`. Its return value is the **peer SDK Server**, not a
Core replacement. `serverInfo` uses SDK `Implementation`; the access context uses
SDK `RequestHandlerExtra<ServerRequest, ServerNotification>`, including its
`authInfo?: AuthInfo`. Rich Host Actors retain the dispatcher Actor type.

```ts
import {createCapabilityMcpServer} from '@immedi/iaic-core/mcp/server.js';
import {connectCapabilityMcpHttpTransport} from '@immedi/iaic-core/mcp/http.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
const server = createCapabilityMcpServer({dispatcher, resolveAccess});
const transport = new StreamableHTTPServerTransport({enableJsonResponse: true});
await connectCapabilityMcpHttpTransport(server, transport);
// Host middleware verifies the request, sets req.auth, then calls handleRequest.
```

The optional helper lives in `mcp/http.js`; importing the basic server alone does
not pull HTTP transport declarations into other transports' type checks.
The helper delegates to `server.connect(transport)` without changing runtime,
transport, credentials, or authorization. Direct SDK connection still works in
ordinary strict NodeNext. Both use the application's optional peer, tested at
1.30.0; Core does not install a private SDK or patch node_modules.

**Known upstream limitation:** SDK 1.30.0's Node HTTP server and client transport
classes fail TS2420 against their own `Transport` interface with
`exactOptionalPropertyTypes` (explicit undefined callback/session getters versus
optional interface properties). Core declarations cannot repair the SDK's own
`implements` checks. Applications using that flag currently need `skipLibCheck`
for the upstream declarations or an upstream SDK correction, even with this helper.
Do not describe the full-library exact-optional compile as passing. The installed
consumer first checks all declarations and permits exactly those two SDK TS2420
diagnostics, rejecting every other diagnostic; it then emits with `skipLibCheck`.
Core and consumer types are checked with exact-optional enabled. The test client
has one explicit expected upstream connect error; the application **server** uses
no cast, ambient shim or expected-error suppression. The existing ordinary strict
package gate remains enabled without skipLibCheck. This bounded compatibility
allowance must be revisited with any SDK upgrade.

### Trusted identity remains a Host port

A type is not proof of token validity. Host middleware must verify token signature
or introspection, expiry, intended resource/audience and current revocation before
setting `req.auth`. A client JSON field named `authInfo` or `actor` is never this
context. `AuthInfo.extra` is untrusted unless the Host itself constructs/validates
its contents. `resolveAccess` must derive current Actor/context and current
capability visibility for each request, and the Dispatcher separately checks
current domain authorization at execution. Do not log bearer tokens or copy them
into tool inputs, task history or memory.

For authenticated use, reject missing/invalid identity at the HTTP boundary with
401 and `WWW-Authenticate` referring to protected-resource metadata, **before** MCP
initialization. If needed, serve an explicitly anonymous public endpoint separately.
The installed `examples/core-types-consumer/mcp-server.mts` uses a local fixture
verifier, separate endpoints, metadata and real SDK HTTP requests. It exercises
missing/expired/wrong-resource credentials, token revocation, current Actor revision,
Dispatcher denial after cached discovery, forged input identity and stable write
keys. This is not an OAuth authorization server, PKCE flow or real-user login test.
A complete mock authorization-server example and stable auth error taxonomy remain
pending; production OAuth/CORS/rate limits/consent/token storage stay Host-owned.

Migration: install candidate.103 plus the tested peer, remove the application's
server ambient declaration, and replace a local server transport cast with the
helper if needed. Preserve existing authentication and access resolvers. No schema,
Task or database migration occurs. Rollback to 102 requires restoring the local
types/connection boundary; existing operations and request keys are unchanged.

Candidate.104: MCP server `surface` defaults to `model`; Host-only capabilities are
hidden and guessed names denied. Only trusted composition may explicitly select
`host`; external personal agents should receive the model endpoint. See
../capabilities/VISIBILITY.md. AuthInfo and current Dispatcher authorization remain
required independently of visibility.
