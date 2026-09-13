# Bind a persistent Agent to an evaluated release

`ReleaseBoundAgentIdentity` decorates the existing Runtime `agentIdentity` port. It preserves the normal identity binding (including purpose and instance), adds a pinned `{releaseId,manifestDigest}` under its reserved `release` field, and checks the same ReleaseManager before admission and later execution. It creates no new Task state machine or Agent role.

```js
const selected = await releases.resolve(actor, 'production');
// Materialize/verify referenced files and resolve immutable host configuration
// before constructing this implementation's model, tools, Skills and Prompt.
const identity = {
  bind: ({actor, capability}) => registry.bind(actor, jobId, capability.name),
  check: ({actor, task, binding}) => registry.check(actor, binding, task.capability)
};
const agentIdentity = new ReleaseBoundAgentIdentity({
  identity, releases, reference: selected,
  implementationRevision: selected.manifest.implementationRevision
});
const runtime = new AgentRuntime({
  store, dispatcher, model, context,
  version: selected.manifest.implementationRevision, agentIdentity
});
```

The Runtime now includes `version` in its identity `bind` arguments. Existing identity hooks may ignore this additional field. The decorator requires that Runtime version, configured implementation revision and currently checked manifest revision agree. The original identity must return a plain JSON object without a `release` property. Its check receives the original base binding both as `binding` and `task.agent`, keeping existing registry semantics intact.

On admission, current release checks bracket identity binding. On execution, the saved release reference must match the configured one, and current release checks bracket the base identity check. Runtime's existing checks therefore block new inference/actions from stopped bindings and prevent a newly stopped model response from dispatching its proposed tool action. Existing Agent pause, current scope and identity policy remain effective.

## Selection is not migration

A channel change affects later selection, not a Task's saved binding. Hosts retain the original configured implementation when resuming old work. An old Task cannot be silently rebound to the fallback; explicit lifecycle/recovery decisions remain necessary. The Runtime still fences version mismatches using its existing waiting state. This decorator does not supply a multi-version worker router, cloud traffic switch or update an already running model.

A release stop blocks later checks. It does not cancel an external action already admitted, prove that an in-flight model request did not run, reverse charged usage or erase historical results. Keep existing effect/usage reconciliation and business compensation rules. Current authorization to read historical Task results remains the existing Task/Capability policy; stopping execution is not an automatic historical-data access revocation.

## Host implementation responsibility

ReleaseManager registers evidence-bound manifests and ReleaseResources verifies referenced bytes. This adapter connects their release identity to ongoing Agent work; it cannot infer whether host code actually loaded the declared model policy, Prompt, Skills, Tools or Knowledge. The host must resolve those immutable references correctly and use a new implementation revision for changed content/configuration. A label alone does not freeze vendor model weights or make a test dataset independent.

The caller owns the PostgreSQL pool, registry, worker lifecycle and current ReleaseManager authorization. Only ordinary release check permission is needed by a working Agent; release registration/stop/rollback authority remains separate host policy. No mandatory Platform/User/Business classes are introduced.

Integration evidence uses real PostgreSQL, separate capability/regression fixture evaluations and the same AgentRuntime. It covers channel changes with original binding retained, service reconstruction, stop before inference, stop while a model response is returning, version/reference substitution and original identity pause. The installed release example materializes pinned resources, stops a canary via existing observation rollback, blocks its queued Agent and executes a newly admitted fallback Agent. These are deterministic models, not a new real-model rollout, live cloud deployment or full Note 30 evolution acceptance.

## Load checked bytes without a temporary directory

`await resources.read(actor, reference)` returns `{releaseId, manifestDigest, files}` where each file contains `path`, `sha256`, `byteLength` and an independently copied `Buffer` in `bytes`. The original release reference and resource descriptors are snapshotted before asynchronous resource reads; the release is checked again before returning. All bytes must satisfy the manifest and configured aggregate limits. This supports host loading of Prompt, JSON configuration or other resource bytes without filesystem materialization. The installed release example uses it for both candidate and fallback Agent prompts.

The caller chooses decoding, schemas and how resources become model/tool/Skill configuration. Returned buffers are caller-owned and mutable; modifying them does not update the evaluated release. This is not automatic code execution, a plugin loader or proof that a remote model's weights are immutable. `materialize` uses the same checked-byte path and rechecks the release after writing its private directory. Peak memory is bounded by the declared aggregate resource limit plus reader/copy overhead; the trusted reader must enforce its own transport limits.
