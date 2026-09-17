# Trusted Host context and Actor restoration

Candidate.100 separates model-visible Host information from execution authority.
Import `HostTaskContext` from `@immedi/iaic-core/context/host.js` (strict NodeNext
declarations included). No application Principal, Role, Market or business
permission schema is part of Core.

The Host provides four ports:

- `bind({actor,capability,requestKey,hostVersion})` returns `{schema,version,
  reference,revision,projection}`. It selects an immutable, minimal, redacted
  application snapshot from authenticated host state. The request deliberately
  has no user goal/input. Never copy an HTTP body, memory or tool argument into
  these fields. Ports may inspect authenticated Host state, not user assertions.
- `authorize({actor,taskId,binding})` checks current access, original scope/context,
  and revocation; taskId is null only during binding. This must read current
  policy, not merely return true because the snapshot was once authorized.
- `resolve({actor,taskId,binding})` reads the original immutable projection by
  reference/revision. Core verifies its digest. Do not resolve an old revision to
  today's projection; retain pinned schema/version readers until Task retirement.
- `readTask(actor,id)` is an owner-scoped read of the persisted Task including
  trusted_context, normally `TaskStore.get`. It must never read an arbitrary
  principal's Task. Core also verifies the binding owner.

Optionally provide `restoreActor({actor,taskId,binding})`. It reconstructs the
application's current business Actor from trusted storage after current access
checks. The result must retain Core scopeId/subjectId. This operation is separate
from `project`; a model-visible principalId is not an authorization credential.
The application validates its own projection schema, selects redacted fields,
and authorizes business effects using the restored Actor.

## Runtime and starter wiring

Pass the service as `new AgentRuntime({...,trustedContext:service})`. The ordinary
Agent starter `developer/templates/agent/app.mjs` also accepts `hostContext` ports
and wires its own TaskStore read port; the returned `app.hostContext` is the
service. Candidate.101 adds a strict declaration for the ordinary starter entry
and its Task/Host/allowance ports. Optional extensions and raw module handles are
not fully declared; see `developer/templates/agent/README.md` for exact scope.

Task creation persists only `{source,schema,version,reference,revision,digest,
owner}` in trusted_context and the created audit event, atomically with the Task.
The reference/revision must point to a snapshot that the Host already durably
created. Use stable requestKey binding: retries must resolve the same snapshot;
a changed binding under the same Task request key conflicts rather than rewrites
history. A failed Task admission can leave an unused application snapshot, which
the application owns. Core stores no projection body or secrets in this slot.

Every model turn resolves and checks the pinned projection. ContextAssembler
adds a separate system message containing structured `hostContext` data with an
explicit source/non-authority rule. The user's goal remains in the user message;
a same-named field there cannot set the persisted binding or restored Actor.
This distinction is structural input provenance, not a claim that any LLM is
immune to prompt injection. Deterministic authorization still decides effects.
Projection data is plain JSON, bounded to 16384 bytes/depth20 and counted in the
context budget. Keep only fields needed by the model; even an opaque reference
must not contain a secret. Core does not log the full projection by default.

Task lifecycle reads/changes and Runtime execution recheck current Host access.
Restart without the configured resolver fails closed for bound Tasks. Cross-owner
access, revoked policy and context switching must fail in the Host access port.
A current policy revision may advance while a still-authorized old immutable
projection remains pinned. Permission expansion is not inherited from a model
projection; permission removal must be enforced by current Host policy.

## Business functions and history

```js
const businessActor = await app.hostContext.restoreActor({
  actor: context.actor,
  taskId: context.taskId,
});
await domainService.submit(input, {actor: businessActor, key: context.callId});
```

Place this check in a read-only `preflight` before write dispatch and check current
business policy again at the authority boundary. Never treat input.actor or an
input taskId as the trusted invocation context. No business adapter is silently
wrapped or authorized by Core; the application owns the domain call.

Every function result retained in Agent history needs `revalidate`, including
capability discovery, confirmation cards and status reads. The ContextAssembler
now passes the persisted call's task_id as context.taskId to the revalidator, in
addition to actor/callId, so it can use the same current Actor resolver. Missing
revalidation still fails closed; it never re-executes a previous write. Full
compile-time enforcement for all starter capabilities remains pending.

## Migration and examples

Migration018 adds a nullable trusted_context column. Legacy Tasks remain null;
Core does not invent historical snapshots. Hosts requiring bound context must
explicitly refuse legacy Tasks or keep them on their original policy. **Do not
run context-bound Tasks on older Core executors**, which do not enforce this
contract. Drain/stop old workers and give context-enabled application code its
own host version; preserve original Task and business effect identities.

The packed [runnable example](../examples/core-host-context/README.md) uses real
PostgreSQL plus a deterministic model. Strict installed consumers compile and run
the typed service without a root ambient shim. Integration checks cover restart,
current context revision, revoked/cross-subject access, user-field spoofing,
changed snapshot contents, projection-version upgrades, history revalidation,
missing resolver and a single original write. Application production integration
and schema/redaction policy remain application work.
