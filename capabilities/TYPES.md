# TypeScript capability and HTTP contracts

Candidate.94 supplies strict NodeNext declarations at these existing public module entries:

| Import | Supported surface |
| --- | --- |
| `@immedi/iaic-core/capabilities/index.js` | defineCapability, CapabilityDispatcher, Actor/context, typed input/output definitions, Agent definition and Task admission port |
| `@immedi/iaic-core/capabilities/errors.js` | Structural Core error fields and publicErrorFields |
| `@immedi/iaic-core/http/server.js` | Fetch handler and host access resolver |
| `@immedi/iaic-core/http/client.js` | Named client contracts, result discrimination and HTTP errors |
| `@immedi/iaic-core/releases/identity.js` | Installed release identity (introduced in candidate.93) |

Use these module imports directly; no ambient `declare module` shim or `skipLibCheck` is needed for the covered surface. The root index and remaining modules, including full AgentRuntime/TaskStore/Peer APIs, are **not yet declared**. This is a partial delivery of Note47 §25, not completion of the whole-package request. Existing root JavaScript imports remain unchanged. A consuming application must decide whether to migrate these imports now or retain its shim until root coverage is supplied.

`defineCapability<Input, Output, Actor>` checks host implementations and callback signatures. `CapabilityDispatcher<Contracts, Actor>` and `CapabilityHttpClient<Contracts>` check named invocations using an application-declared contract map. JSON Schema validation remains the runtime authority; declarations do not infer types from arbitrary dynamic schemas or prove a contract map matches host registration. Keep the map and the application's schemas consistent. An unparameterized dispatcher returns unknown results, requiring narrowing rather than silently claiming a shape.

An Agent capability's output schema describes its eventual business result. Invoking it through the dispatcher returns a **Task receipt**, not that final result; use TaskReceipt as that entry's invocation output contract. The typed Task creation port and fixture establish admission shape only. They do not declare or validate the full Agent execution lifecycle. The HTTP client's task branch remains unknown for host-defined task projections; narrow it before reading fields.

Actor identity and optional invocation callId/signal/allowedCapabilities/taskId match the dispatcher. Function execution receives the frozen actor, a nullable callId/signal and optional taskId; history revalidation receives a smaller context. UUID/length/schema, authorization, preflight-hook restrictions and immutable runtime behavior are still enforced at runtime. Structural error interfaces are types, not new runtime error constructors; the existing CapabilityHttpError class remains available.

`npm run verify:types-package` packs and installs Core into a separate consumer, installs pinned TypeScript 5.9.3, compiles with strict NodeNext and no skipLibCheck, then executes the emitted program. It checks direct and HTTP writes, actual context propagation, denied preflight and Task admission, with eight compile-only rejection checks. The normal runtime/package gates continue separately. See `examples/core-types-consumer/consumer.mts` for a complete host example. No 12Eat dependency or local shim is modified by this gate.
