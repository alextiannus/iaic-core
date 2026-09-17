# Capability consumption surfaces

Candidate.104 adds optional `visibility: 'model' | 'host' | 'both'` to
`defineCapability`. Omission means `both`, preserving existing declarations.
Invalid values fail with `INVALID_CAPABILITY_VISIBILITY`. This is trusted registry
configuration. Input, headers, model arguments and memory do not set the surface.

- `dispatcher.invoke(name,input,{actor,surface,...})` defaults to **host**, because
  it is the trusted direct application API. Calling code that exposes invocation
  to a model must explicitly bind model, or use the model adapters below.
- `dispatcher.toolsFor(actor,{surface})` defaults to **model**. Its handlers bind
  both Actor and surface; execution options cannot override them.
- HTTP and MCP server constructors default to **model**. They filter discovery and
  reject guessed/cached unavailable names at call time. The Host may compose a
  separate server with `surface:'host'`, restricted to its authenticated native UI
  or transport operations. Never choose this constructor option from request data.
- Agent Runtime always uses **model** for function tools, including result-wait
  reads. Task allowedTools can only narrow the Agent declaration; it cannot grant
  access to a Host-only name. Host-only Agent admission can still start a Task via
  Host invocation; the Agent's internal tools remain on the model surface.

Surface denial is `CAPABILITY_SURFACE_DENIED` (403), and invalid surface is
`INVALID_CAPABILITY_SURFACE` (400). HTTP/MCP publish the stable code. Runtime
feedback records the surface denial for a guessed tool before preparing a call.
Surface-compatible discovery does not prove permission: every actual call still
passes current Actor validation, authorization, schema, execution policy, stable
write key, preflight and verification. Unknown write outcomes retain their existing
semantics. This adds no bypass for Formal Action, Mandate, Principal or application
confirmation policies. Those policies must remain in the shared dispatch/domain
path, including on Host endpoints.

```js
const prepare = defineCapability({
  ...hostOwnedDefinition,
  visibility: 'host',
});
const nativeUi = createCapabilityHttpHandler({
  dispatcher, resolveAccess: resolveCurrentAuthenticatedUiAccess, surface: 'host',
});
const modelEndpoint = createCapabilityHttpHandler({dispatcher, resolveAccess});
```

Core does not infer whether a caller is a human or AI from network metadata. Host
composition is the trust boundary. Do not give an external model a Host endpoint
or a raw dispatcher facade that defaults to Host. Applications own endpoint auth,
CORS, resource scopes, native action evidence and which capabilities are exposed.
`model`-only declarations also deny direct Host calls unless that trusted caller
explicitly selects the model surface. Most ordinary capabilities should use `both`.

## Historical data and changes of policy

ContextAssembler revalidates the current surface of every stored call **before**
reading/projecting its result. Runtime performs its own check before model assembly
or pending batch execution, so a custom assembler cannot bypass that stored-call
check. Runtime.get also refuses old inaccessible call history. A Task whose old
call becomes Host-only waits as `interrupted` with error
`CAPABILITY_SURFACE_DENIED`; no model invocation, effect replay or history erasure
occurs. State-only lifecycle reads and cancellation remain available. The Host
retains original operation receipts for reconciliation and may expose a separately
authorized minimal business result through a model-visible read capability.

This is not retroactive redaction: data previously sent to a provider cannot be
withdrawn. Host-supplied goals, memories, session/peer projections and custom
assemblers are still trusted composition responsibilities; never copy transient
credentials into those channels. This module does not add secret scanning, a
credential vault, immutable Artifact transfer or automatic rewriting of old Tasks.

## Migration and finite compatibility

No database migration. Registry definitions belong to a Host code version; change
visibility through controlled Host replacement, not concurrent in-flight registry
mutation. There is no new hot policy-reload protocol. Existing undeclared capabilities remain `both`; this does
not automatically fix application string blacklists. Explicitly classify sensitive
capabilities, use a separate authenticated Host route and verify current policies.
Stop/drain old Core executors and retire old endpoints **before** enabling these
declarations: candidate.103 and earlier ignore visibility and cannot safely run
under the new policy. Version-bind Task hosts; do not silently attach a new Host
result to an old model-visible call. A tightening that conflicts with history needs
Host recovery/new version planning; it is not permission to replay a completed write.

Rollback to 103 is safe only before adopting the feature, or after restoring an
independently enforced equivalent Host isolation policy. Never roll back to an
unaware executor while relying on visibility to keep transport credentials private.

`examples/core-capability-visibility` runs from an independently installed tarball:
HTTP/MCP discovery and calls, cached tool handles, forged surface options, cross-user
and current authorization, idempotent Host writes, model guessing, and real PostgreSQL
Task restart/history tightening including a custom assembler. Fixture models and
in-memory domain receipts prove wiring, not production application acceptance.
