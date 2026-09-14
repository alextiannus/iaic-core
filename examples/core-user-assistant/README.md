# User AI Assistant demo

This user-approved addition supersedes the earlier “no User Assistant demo” scope.
It is a small application composition, not a mandatory assistant UI or new Core Agent
class. The user may be an individual or a provider organization. Business AI does not
inherit that user's authority, and Platform AI maintains the framework rather than
submitting declarations on their behalf.

## Run the verified fixture

```sh
npm ci
export SUBMISSION_TEST_DATABASE_URL='postgresql://localhost/iaic_example'
node examples/core-user-assistant/run.mjs
```

The deterministic model exercises the real persistent Runtime and application tools:
private preference → progressively loaded Skill → application Schema → Workspace draft
→ missing-field question → service reconstruction → user answer → authorized submission
→ original receipt → verified result. Tests also cover zero allowance without inference,
user isolation, current mandate denial and request-key conflict/deduplication. The HTTP
handler is exercised through Fetch Request/Response in process, not network conformance.
The temporary PostgreSQL schema is deleted after the run. No real model or 12Eat order
is invoked in this fixture. Plans are wired but their use is not asserted by this demo.

## Run with a system model

Provide DATABASE_URL, APP_TOKEN, APP_SUBJECT, APP_ORGANIZATION, IAIC_MODEL, AI_API_KEY
and DECLARATION_SCHEMA_PATH (an application-authored JSON Schema file). Optionally set
IAIC_PROVIDER=chat-completions and IAIC_MODEL_BASE_URL for a compatible provider.
No business fields are built into the host. The fixture's description/capacity schema
is a test input only, not a market or provider declaration specification.

Set ALLOW_DECLARATION_SUBMIT=true only to enable this authenticated user's demo
submission mandate. A real host replaces this with its current Principal/Role/Mandate
policy, not a model-supplied confirmation. Existing authorization is reused; missing
information is clarified through the same Task without another execution engine.

An explicit local operator may set DEMO_ALLOWANCE_UNITS and a stable
DEMO_ALLOWANCE_REFERENCE to fund the user scope. No allowance is granted by default.
These are platform-issued units; the demo uses configured unit rates, not currency or
literal purchased provider tokens. The default system model is pinned to each Task.
No BYOK switching UI or new BYOK implementation is added.

```sh
node examples/core-user-assistant/server.mjs
# In another terminal with the same APP_TOKEN:
node examples/core-user-assistant/chat.mjs
```

The server binds loopback port 3012 by default. The terminal is a minimal conversation
client: it starts a durable Task, displays status/questions, accepts clarification or
/cancel, and shows the verified result. Keep the printed Task ID to inspect/recover
through tasks.get, tasks.provide_input and tasks.control_result after disconnecting.
Use the same request key on retries; do not create a new intent after an unknown result.
The real-provider entrypoint is supplied but real-model quality is not yet validated.

## Reuse and design decisions

AMC-MM source inspected: commit `9803636493baa52352039f64655c55c0ee83d454`,
`src/lib/companion/{profiles,memory,skills,conversation}.ts`. `persona.mjs` adapts its
profile fields and concise conversational behavior. Explicit preference memory,
progressive Skill discovery and unfinished-work continuity reuse that design through
Core persistence. This is a small adaptation, not a copy of AMC-MM's entire companion.

Browser localStorage, brand/BD enums, logistics Skill names, avatars, voice assets and
regex-based “confirm” intent detection are not execution authority and are not imported.
No Claude/Claw code is copied. Codex-like working behavior uses Core's durable Tasks,
optional plans, private Workspace artifacts, tool execution, clarification and receipts.
A friendly persona changes expression, not permissions or verification requirements.

## Module boundaries and limits

- application.mjs composes the existing Agent starter, resource modules and system model.
- persona.mjs contains presentation behavior only; it cannot grant access.
- skills/declarations explains the workflow without fixing application fields.
- declarations.mjs is a replaceable **demo application adapter**. The PostgreSQL table
  is a sample authority for declared payloads, not a Core CapabilityDeclaration entity.
  Replace it with the consumer's published authorized API and original-effect query.
- server/chat are local entrypoints; applications own authentication, UI/UX and connectors.

The demo outcome verifier requires a currently retrievable original declaration receipt.
It is scoped to submission work, not a general companion/chat-product verifier. Free chat,
avatars/voice, proactive scheduling, real-model evaluation, 12Eat integration and external
provider reconciliation are not completed by this example. Reconstruct the same version
for old Tasks; changed host code/schema/profile produces a different version binding.
Core's TypeScript declarations gap remains separate and pending.
