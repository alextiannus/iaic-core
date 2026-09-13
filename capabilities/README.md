# Capability contracts and dispatch

`index.js` exports `defineCapability` and `CapabilityDispatcher`. This module owns immutable input/output schemas, read/write effect and retry declarations, authorization, deterministic preflight, execution and output verification. Inject actor validation, capability definitions and an optional persistent-task port. It does not read application services or storage tables.

Function capabilities have `implementation.kind=function` and an execute function. Agent capabilities define instructions, deterministic tool names and an outcome verifier; the injected task port admits their persistent execution. Writes require a stable call identity and declared idempotent/never-replay behavior. An uncertain post-dispatch write is not a known failure to apply the effect.

Optional `waitReady(input,result,{actor})` is a trusted readiness predicate allowed only on read function capabilities that also define current history `revalidate`. The Dispatcher still returns a normal immediate read response. The Agent Runtime interprets not-ready as a durable wait for that read result; readiness does not mean the Agent goal is complete. See `../agent/README.md` and `../tasks/README.md` for persistence, current authorization and resume rules. Applications define business readiness without adding their status enums or UI to Core.

Focused tests: `test/iaic-capabilities.test.js` and `test/iaic-result-waits*.test.js` in the host repository. The independently installed `examples/core-result-waits` consumer uses these public contracts without ImmediToday.

A deterministic function may provide `projectHistoryInput(input,{actor,callId,status}) -> object` for its model/history display. It receives a cloned input after current authorization; output can omit original required fields because it is a projection, not an executable request. Context marks the call `inputProjected:true`. Authorization, source revalidation, invocation, result verification and durable reconciliation use original arguments. Invalid hooks or projection output fail explicitly. This does not modify persisted calls or erase audit records.
