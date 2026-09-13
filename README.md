# IAiC Core

A headless JavaScript framework for AI Native Applications: configure an Agent's responsibility and resources, give it a goal, let it use authorized capabilities, and retain work and results beyond a chat connection.

This is the **0.1.0 public source candidate**, published at https://github.com/alextiannus/iaic-core. A reuse license has not yet been selected; public visibility does not imply an MIT or other open-source license grant. See [STATUS.md](STATUS.md) for verified capabilities and limits.

## Start here

Requirements currently verified by this candidate: Node.js 20, npm, and an isolated PostgreSQL database for persistent examples. PostgreSQL connections belong to the host application; Core accepts an injected pool.

```sh
npm ci
export SUBMISSION_TEST_DATABASE_URL='postgresql://localhost/iaic_example'
npm run example:jobs
```

Use your own database connection. The examples create temporary synthetic schemas and remove them when finished. Default examples use deterministic model fixtures, not a paid model endpoint.

The configured-jobs example combines user-plus-organization scopes, an organization-shared job, Memory, Workspace, sourced Knowledge, selected Skills, models and platform allowance, Session continuity, model-directed scheduling and an external MCP client. It includes application policy to illustrate composition; it does not prescribe job types or business flows.

```sh
docker pull node@sha256:8094c002d08262dba12645a3b4a15cd6cd627d30bc782f53229a2ec13ee22a00
npm test                     # module checks and 29 standalone examples
npm run verify:core-package  # pack, install elsewhere, run examples there
npm pack                     # create a reusable Core npm archive
```

The full test suite and package verification also require a running Docker daemon and the pinned image above for actual sandbox execution.

An application installs the resulting `.tgz` and imports `@immedi/iaic-core` or a module subpath. It does not import a platform server or copy Core into every application. See [GETTING_STARTED.md](GETTING_STARTED.md).

## Basic modules

| Need | Modules and contracts |
| --- | --- |
| Develop and migrate an application | [Developer tools](developer/README.md): CLI, independent starter and versioned PostgreSQL migrations |
| Manage accounts and organizations | [Accounts](accounts/README.md): replaceable directory, memberships and current identity mapping |
| Record money and execute payments | [Payments](payments/README.md): confirmed invoice sources, charge/refund intents, provider adapters and reconciliation |
| Resolve subscription access | [Subscriptions](subscriptions/README.md): versioned plan snapshots, current periods and entitlements |
| Deliver background results | [Notifications](notifications/README.md): durable queue, channel ports, attempts and reconciliation |
| Evaluate capability changes | [Evaluation](evaluation/README.md): independent grading, complete case coverage, baselines and evidence |
| Select evaluated releases | [Releases](releases/README.md): immutable version bindings, canary selection, stop and rollback |
| Store binary resources | [Object storage](storage/README.md) and [release resource loading](releases/README.md): scoped content references and verified files |
| Execute released code | [Execution](execution/README.md): pinned Docker sandbox, resource loading and shared code capability |
| Describe executable operations | [Capabilities](capabilities/README.md): schemas, authorization, functions or Agent implementations, result verification |
| Persistent work and model loop | [Agent](agent/README.md), [Tasks](tasks/README.md), [Context](context/README.md) |
| Configure jobs and long-lived work identity | [Identities](identities/README.md): `AgentRegistry.register`, host JSON configuration, revision-bound tasks |
| Remember, reference and produce | [Memory](memory/README.md), [Knowledge](knowledge/README.md), [Workspace](workspace/README.md) |
| Discover installed working methods | [Skills](skills/README.md): selected catalogs and progressive reads |
| Choose a model and account for use | [Assistants](assistants/README.md), [Credentials](credentials/README.md), [Billing](billing/README.md) |
| Continue conversations and proactive work | [Sessions](sessions/README.md), [Deferred](deferred/README.md), [Events](events/README.md), [Triggers](triggers/README.md), [Recurring](recurring/README.md) |
| Authorize and cooperate | [Mandates](mandates/README.md), [Handoffs](handoffs/README.md) |
| Connect an external Agent | [A2A](a2a/README.md), [MCP](mcp/README.md), [HTTP API and remote SDK](http/README.md), ordinary ESM interfaces |

Each module owns its state and documents its injected dependencies. [Assistant work composition](assistants/TASKS.md) combines these ports without another Runtime or container framework.

## Application boundary

Core provides basic capabilities, interfaces and necessary runtime rules. Applications own authenticated identity mapping, business truth and calculations, capability implementations, installed Skill code, configuration storage/distribution, resource-sharing policy, service deployment and UI/UX.

Business AI represents system responsibility; User AI represents a user or organization's work and may run continuously; Platform AI helps develop and improve the application and may be an external tool such as Codex. These describe possible uses. Core does not require three role classes or three internally deployed Agents.

Default long-lived resource scoping should distinguish user plus organization. Applications can explicitly share company resources or configure a shared job. A shared resource scope does not automatically grant access to every member's Task history. A personal external Agent can call authorized capabilities without adopting Core Runtime.

## Source and validation

[SOURCE.json](SOURCE.json) records the source revision and hashes of extracted files. The candidate includes Core modules and neutral examples only; private application implementations, credentials, production data and private Git history are not included. Some inherited module notes refer to historical integration locations; those are context, not runtime dependencies or files required by this candidate.

Core-only module checks now live in `test/` and run with `npm run test:modules`; application-coupled integration suites remain in the application repository. Each check imports the Core package directly. The independent CI runs module checks and the standalone examples from a fresh package installation. These checks establish the documented composition contracts; they do not establish universal model quality or completion of every AI Native Application requirement.

The complete delivery target and acceptance conditions are tracked in [CORE_REQUIREMENTS.md](CORE_REQUIREMENTS.md). Current usability does not imply that all conditions are satisfied.
