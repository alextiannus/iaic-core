# Model readiness: trusted capability and verification gate

Candidate.105 adds the optional `agent/model-readiness.js` module. This is a
provider-neutral **evidence checker**, not a model directory, probe runner,
multimodal message implementation or OAuth/secret store. Existing ModelProfiles
and model identities are unchanged. Hosts explicitly compose the gate for each
job/model; no requirements are inferred from user or model text.

```js
const resolved = await host.resolveConfiguredModel(profileId, {expectedIdentity});
const checked = withModelReadiness({
  model: resolved.model,
  binding: resolved.binding,
  requirements: ['text_input', 'tool_calling'],
  resolve: ({modelIdentity, signal}) => host.readCurrentModelVerification({
    modelIdentity, signal,
  }),
});
const metered = meteredModel({model: checked, ledger, scope, policy});
// Inject metered as Runtime.model or return it from Runtime.resolveModel.
```

Requirements are a copied immutable list of up to 64 unique, lower-case tags.
They describe what this Host job needs; tags alone do not add media transport or
prove an adapter's schema compatibility. Select a different explicit Host model
composition for jobs requiring different capabilities. A first-class per-Task
requirements field and automatic ModelProfiles integration are not added here.

## Host snapshot contract

`resolve` returns a fresh trusted snapshot containing:

- `active`: current Host authorization/availability, including credential revocation.
- `binding`: modelIdentity, full HTTPS endpoint, opaque credentialRevision and
  certificateIdentity for the current configured adapter.
- `declaredCapabilities`: the Host's explicit capability declaration.
- `verification`: a separate probe evidence record with its own binding,
  demonstrated capabilities, `tlsVerified`, verifiedAt and expiresAt (integer
  milliseconds since epoch). Expiry must be after verification and in the future.

The wrapper captures the binding of its actual resolved adapter at construction.
The checker requires this captured binding, the current Host binding and the
evidence binding to match, verified TLS, valid time bounds and every requirement
in **both** the declaration and evidence. Endpoint comparison includes path and
origin; query strings, fragments, credentials and plain HTTP are rejected. Resolver
errors become a fixed public code, never arbitrary provider text or a token dump.
Successful `checkReady()` returns bounded binding/time/capability metadata for Host
audit; it is not automatically copied into model context or persistent Task data.

The Host must capture binding together with the actual adapter/credential
configuration, not simply copy the proof's fields. A captured old API key must not
be labelled with the latest credential revision. Rotation requires resolving a
new adapter and wrapper, even if new evidence is already available; original
model identity checks still apply. `credentialRevision` is a non-secret rotation identifier,
never an API key or its direct hash. `certificateIdentity` is the Host's current
verified peer identity. A change requires fresh bound evidence. Valid certificate
renewal can be accepted by revalidation; certificates are not permanent model IDs.

The resolver reads current evidence and revocation state; it must **not** run a
billable probe as a side effect. A Host probe must actually test the requested
capabilities with its real endpoint/credential and must validate TLS. Metadata from
a vendor catalog or model-generated JSON is not proof. Adapters still enforce TLS
on every real request; an earlier probe never permits insecure transport or
redirects. This module does not perform real handshakes, inspect certificate chains,
verify media encoding or issue provider requests. Those adapter/probe integrations
and their production acceptance remain explicit application work.

## Admission, billing and continuing work

Runtime calls an optional model.checkReady before persisting a new Task. The billing
wrapper forwards this hook and runs it after checking existing unknown usage but
before reserving new platform allowance. The readiness wrapper checks again just
before invoking its provider, covering expiry/revocation during reservation.

On a readiness rejection no provider call occurs. A pre-reservation rejection
creates no new hold. If the second check rejects, existing meteredModel handling
releases **only the current new request's** hold with provider-not-called evidence.
An older unknown hold remains subject to reconciliation and is never released by
readiness metadata. Neither layer chooses another model or automatically retries.

Failures use stable public codes:
`MODEL_CAPABILITY_MISMATCH`, `MODEL_VERIFICATION_REQUIRED`,
`MODEL_VERIFICATION_EXPIRED`, `MODEL_VERIFICATION_STALE`,
`MODEL_TRANSPORT_INSECURE`, `MODEL_READINESS_REVOKED`, and
`MODEL_READINESS_UNAVAILABLE`. They carry providerNotCalled=true. Runtime preserves
the code in a waiting/interrupted Task and records providerNotCalled/failureCode
in the failed model-attempt event. It does not misclassify these as a provider
execution failure. No new database waiting_reason is added. Once the same model has
fresh valid evidence, an explicit normal resume can continue; original operation
receipts and unknown usage constraints still apply.

## Migration and limits

Opt-in, no database migration. Pin this configuration to a new Host version; drain
old executors before relying on the gate. Old Tasks keep their original configured
model identity, and no historical proof is invented. Their Host owner decides
whether to keep the original configuration or stop/reconcile them. Do not silently
replace their model, requirement set or provider endpoint.

The wrapper preserves the underlying model name and typed request/response shape.
ModelProfiles' existing expectedIdentity check must remain enabled when resolving
old Tasks. Custom adapters must provide an equally accurate configuration identity.
Rollback to 104 removes the admission/pre-reservation hooks, so restore equivalent
independent checks or disable jobs relying on readiness before rollback. A runtime
version unaware of the gate must not execute tasks that depend on it.

`examples/core-model-readiness` runs an installed package with isolated PostgreSQL
and fixture proof/provider/ledger ports. It checks admission refusal, time and
binding changes, current revocation, TLS evidence, resolver redaction, no preflight
reservation, retention of old unknown holds, change after reserve, and explicit
same-model continuation after fresh evidence. It is not real Provider/TLS evidence.
Full probe execution, Task-specific requirement persistence, media adapters,
profile catalog integration and richer waiting reasons remain pending.
