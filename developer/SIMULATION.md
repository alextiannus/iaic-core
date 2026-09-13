# Local model and capability simulation

`createScriptedModel` and `LocalSimulation` are optional development adapters. They use the ordinary AgentRuntime, CapabilityDispatcher, schemas, permissions, Task history and outcome verifier. They do not provide another executor, bypass authorization or call a live provider when a script ends.

```js
import {createScriptedModel, LocalSimulation} from '@immedi/iaic-core';
const world = new LocalSimulation({
  initialState: {count: 0},
  resolveScope: actor => JSON.stringify([actor.scopeId, actor.subjectId])
});
const add = world.capability({
  definition: {
    name: 'counter.add', description: 'Local simulated counter',
    input: {type: 'object', properties: {amount: {type: 'integer'}},
            required: ['amount'], additionalProperties: false},
    output: {type: 'integer'}, effect: 'write', retry: 'idempotent',
    authorize: actor => actor.scopeId === 'local' && actor.subjectId === 'developer'
  },
  reduce: ({state, input}) => ({
    state: {count: state.count + input.amount}, result: state.count + input.amount
  }),
  loseResponse: true
});
const model = createScriptedModel({name: 'counter-simulation-v1', steps: [
  {response: {type: 'call', name: add.name, input: {amount: 3}}},
  {response: {type: 'finish', result: {count: 3}}}
]});
```

Register `add` alongside the application's Agent capability and pass `model` to its Runtime. That Agent still declares its allowed tools and an independent outcome verifier. See `examples/core-simulation/run.mjs` for a complete PostgreSQL composition, original receipt reconciliation and Runtime reconstruction.

## Scripted model

Steps are plain JSON `{response}` or `{error}` entries, limited to 100. The existing `billingContext.turn` (one-based) selects the step, so reconstructing the model does not reset a process-local cursor. Multiple Tasks can use the same script independently. Response objects are copied; they are deliberately not filtered into valid actions, allowing invalid-action scenarios to exercise the actual Runtime. Model names and scenario revisions must remain stable for an existing Task; the host owns that configuration, as with other provider adapters.

Error steps carry a message and optional `providerStatus`, `retryAfterMs`, `providerNotCalled`, `providerCompleted`, `invalidAction` and `usage`. They exercise existing error handling; no remote request is made. An exhausted script stops with `providerNotCalled`, and cancellation is checked before each response. No hidden success response, paid fallback or asynchronous timing simulation is supplied.

Usage is supplied explicitly in simulated responses/errors if a scenario tests metering. These are fixture counters, not real provider usage. The simulator neither grants platform allowance nor changes billing rules. Do not treat a scripted result as evidence of actual model competence.

## Simulated tools and state

Each world shares JSON state between its capabilities, partitioned by the host's current scope resolver. A trusted synchronous, side-effect-free reducer receives copies of state, input and actor and returns `{state,result}`. Read capabilities must leave state unchanged. The simulator supplies execution, revalidation and reconciliation hooks; existing live implementations and hooks are rejected rather than copied into a simulation.

Writes commit state and the original receipt in one synchronous local boundary. A key binds scope, capability name and call ID to its input digest. Idempotent repeats return the original result; `never-replay` repeats reject. `loseResponse: true` throws after every new write commits, while the original receipt remains available through `capability.reconcile(input,{actor,callId})`. Current authorization applies to execution, history projection and reconciliation. Missing receipts are unconfirmed. Snapshot reads are trusted host inspection, not public Agent tools.

A world admits at most `maxOperations` new writes (default 1,000, maximum 10,000). It does not silently evict receipts. Create a fresh world for a fresh scenario. State and receipts are **in-memory**, and must be retained when reconstructing just the Runtime; restarting the process loses the simulated world. It is not a durable domain adapter or evidence that an arbitrary remote system can reconcile. No clock/latency virtualization, production credentials, network isolation or code sandbox is provided: reducers and policies are trusted host code and must not call live services. The module itself imports no provider, network, database or sandbox driver.
