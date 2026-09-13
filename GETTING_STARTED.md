# Build with IAiC Core

## 1. Install the library or run the candidate

For this source candidate, run `npm ci` with Node 20. Supply an isolated PostgreSQL URL through `SUBMISSION_TEST_DATABASE_URL` and run `npm run example:jobs`. Use `npm run verify:core-package` to verify the packed library from another directory.

For a separate application:

```sh
npm install /path/to/immedi-iaic-core-0.1.0.tgz pg@8.23.0
```

Install `@modelcontextprotocol/sdk@1.30.0` only if that application needs the optional MCP adapter. Core itself has no PostgreSQL client dependency: persistent modules take your application's pool.

## 2. Start with one capability

A deterministic capability declares its input, output, effect, authorization and implementation. The same contract can be called by application code or exposed through an adapter.

```js
import {defineCapability, CapabilityDispatcher} from '@immedi/iaic-core';

const echo = defineCapability({
  name: 'notes.preview',
  description: 'Preview supplied note text.',
  input: {type: 'object', properties: {text: {type: 'string'}},
    required: ['text'], additionalProperties: false},
  output: {type: 'object', properties: {text: {type: 'string'}},
    required: ['text'], additionalProperties: false},
  effect: 'read',
  authorize: async actor => actor.subjectId === 'demo-user',
  implementation: {kind: 'function', execute: async input => input}
});
const dispatcher = new CapabilityDispatcher({capabilities: [echo]});
const result = await dispatcher.invoke('notes.preview', {text: 'Draft'}, {
  actor: {scopeId: 'demo-organization', subjectId: 'demo-user'}
});
console.log(result);
```

This example actor is synthetic. A real host authenticates the caller and supplies trusted scope; model input is not an identity or permission grant. Domain writes additionally declare retry semantics and use stable request keys and an application-owned effect contract.

## 3. Add an Agent to use capabilities

[core-notes](examples/core-notes/run.mjs) is a small complete host: it creates its own note capability, TaskStore, AgentRuntime and ContextAssembler, runs a model fixture and verifies the result. Function capabilities remain deterministic tools; an Agent capability chooses steps and proposes results. The host's verifier decides what counts as success for its goal.

[core-assistant](examples/core-assistant/run.mjs) adds Memory, an installed Skill and Workspace. `createAgentTaskCapabilities` composes their public ports with one Agent capability. `createAssistantTaskCapabilities` is the same implementation with compatible personal-assistant defaults.

Do not build another task queue or model ledger in a UI adapter. Persistent task admission returns a receipt; read the Task and its artifacts to observe the eventual outcome.

## 4. Configure jobs and resources

[core-configurable-jobs](examples/core-configurable-jobs/run.mjs) shows the complete application wiring. `AgentRegistry.register` accepts a responsibility, permitted Agent capability names and optional host-owned JSON configuration. Role is an optional label. Store configuration in your application's file/database and reload it at startup; distribute revisions through your own host deployment/control mechanism.

Resource ports resolve user-plus-organization/job scope. Select installed Skills through `SkillCatalog.selectEntries`, Knowledge through current source authorization, and tools through ordinary capability authorization. Memory and Workspace keep their own persistence and revisions. Configuration data does not install executable code.

Use AssistantModels/AssistantSettings for model selection. System-managed profiles are the default. The configured ledger accounts in platform-issued allowance units; these are distinct from provider Tokens and money. Exhaustion prevents further paid model admission until allowance is added or the user selects an available own-model configuration. Credentials, provider use and settlement remain separate module responsibilities. BYOK does not silently fall back to a paid platform profile.

For explicit alternatives, compose [AssistantModelRouting](assistants/ROUTING.md) through Runtime's existing resolveModel port. The generated Agent starter accepts optional routing policy/availability ports. A new Task chooses an authorized available profile; a resumed Task retains its real model identity. Route candidates must remain in the user's selected credential mode. Errors and exhausted allowance do not trigger another model.

Provider factories can compose [rateLimitedModel](agent/RATES.md) around [capacityModel](agent/CAPACITY.md) before AssistantModels applies metering. Initialize the shared stores once in the host before constructing providers. Rate limits count provider Tokens; ledger policies count platform allowance. The host supplies a conservative input/output Token bound. See [the starter's optional gateway composition](developer/templates/agent/README.md) and [the installed cost example](examples/core-provider-cost/run.mjs).

[RetentionSweep](resources/RETENTION.md) optionally clears expired current Memory/Knowledge payload under explicit host authorization. It is separate from routing, model calls and app UI, and does not erase Task/Session history or backups.

## 5. Continue work after a conversation closes

`createAgentSessions` projects current Task status and accessible artifact references into the existing Session timeline. `createAgentDeferredTasks` composes the existing deferred worker with ordinary Agent admission and Session receipt recovery. The host supplies trusted actor restoration for background work.

A Session snapshot pins what the task can read. Closing a Session stops new messages; accepted Tasks and schedules remain independent. Future tasks use current model/allowance policy. A scheduled receipt confirms intent, not final completion. See [Assistant work contracts](assistants/TASKS.md).

## 6. Expose capabilities to an external Agent

`createCapabilityMcpServer` exposes a supplied dispatcher with a current authenticated access resolver. If your Agent admission route adds Session linking or internal-key rules, supply a dispatcher facade that routes Agent calls through that same entry. Forward cancellation and access ceilings, and preserve original input validation.

The configured-jobs example includes an external MCP client. It reads Workspace/Skills directly with no hosted inference, or admits durable work and queries its Task/artifact. An external personal Agent can use these interfaces with its own Runtime; using the application's Agent is optional.

## 7. Keep application choices in the application

Build business capabilities, Skills, configuration editors, billing/top-up integration and UI as application modules. Core does not prescribe departments, ERP workflows, role checklists or screens. Platform development can use external coding Agents. See [STATUS.md](STATUS.md) before treating a bounded example as a wider quality claim.

## Work on a module independently

Existing Core-only checks are in `test/`. Set `SUBMISSION_TEST_DATABASE_URL` and run `npm run test:modules`, or run a relevant file with `node --test test/iaic-capabilities.test.js`. No application server or ERP client is imported. The Core workflow runs these checks and installs the packed library in a fresh consumer for the installed composition examples. Application integration checks remain with the application. Adding a module does not require reading its business implementation.

### Explicit model invocation policy

A `ModelProfiles` profile, an approved `UserModels` endpoint, or a direct
`createModelProvider` call may include:

```js
invocation: {toolChoice: 'required', parallelToolCalls: false}
```

`toolChoice` accepts `auto` or `required`. With no policy, Responses retains
`required` and Chat Completions retains `auto`. `parallelToolCalls: false`
limits both the request and local response admission to one action, even if
Runtime permits a larger batch. `true` still respects Runtime's batch bound.
Plain text is never implicitly treated as a verified task result.

Profiles and approved BYOK endpoints bind this configuration into their revision.
An existing task cannot silently adopt a changed policy; a changed BYOK endpoint
requires a newly validated user model configuration. Omitted policy preserves
legacy identities. Unknown policy fields are rejected before credential lookup.

Select a policy supported by the chosen provider and model. An upstream rejection
is surfaced without automatic downgrade, retry or paid-provider fallback. This
setting does not establish model capability or replace outcome evaluation. Direct
provider consumers must bind configuration to their own persistent task identity;
use ModelProfiles/UserModels for the built-in revision checks.
