# IAiC Core

HTTP result update (2026-09-17): candidate.102 adds opt-in typed `invokeResult`
for deterministic business results; `invoke` retains its transport envelope.
Malformed responses retain observed HTTP status and never trigger automatic retry.
See http/README.md for migration, unknown outcomes and the separate pending
visibility/Artifact-transfer work. Application adoption remains unverified.


Typed starter update (2026-09-17): candidate.101 supplies the ordinary Agent
composition's strict NodeNext declaration and an independently installed PostgreSQL
consumer. Task admission, wait/rebuild/continuation, explicit Host Actor restoration
and allowance settlement are exercised. See developer/templates/agent/README.md
for the exact scope: raw module handles remain unknown; optional extension and
full root/Agent/Task/Peer declarations are not complete. No runtime/schema change.


Host context update (2026-09-17): candidate.100 adds Host-only immutable context
references, separate model projections, explicit current business Actor restoration,
and ordinary Agent starter wiring. See [Host context contract](context/HOST.md).
Full starter/root Task declarations remain pending; application schemas, redaction,
authority and production acceptance remain with each application.


Executor handoff update (2026-09-17): candidate.99 adds trusted generation-scoped
drain requests, fenced executor transactions and a bounded Runtime drain port.
In-flight work may finish; the old Runtime retires before another Task claim.
See [deployment contract](agent/EXECUTOR_HANDOFF.md). First upgrades from older
binaries require a controlled executor stop; real rollout acceptance stays with
the application. Host Context/template requests remain pending.


Model failure update (2026-09-17): candidate.98 distinguishes measured output
truncation, invalid actions, provider failures and model deadlines. Deterministic
failures cannot be blindly resumed; unknown usage still requires reconciliation.
See [failure and migration contract](agent/MODEL_FAILURES.md). Executor deployment
handoff and the agent-template typing request remain pending.


Lark type fix (2026-09-15): candidate.97 supplies declarations for both Lark
channel exports, verified by an independent strict NodeNext consumer and official
SDK structural compatibility. Runtime behavior is unchanged; full root and
Agent/Task/Peer types remain pending. See channels/LARK.md.

Provider integration update (2026-09-15): candidate.96 adds WhatsApp Cloud API
and WeCom internal-application text channels, plus Telegram outbound delivery and
verified webhook ingress. All share the existing User Assistant and Outbox.
The WeCom optional encrypted entry uses open-source crypto/XML packages;
WhatsApp requires a current host text-window policy. Live account validation,
attachments/cards and provider Unknown recovery remain pending. See
[provider integration](channels/PROVIDERS.md).


Lark integration update (2026-09-15): candidate.95 adds inbound text and SDK
outbound delivery, plus an optional official Lark MCP bridge with 89 reviewed
tools in eight domains, including group join/member management. Real official
MCP schemas and handlers are exercised with a substituted SDK network boundary;
IM/Task/Outbox integration uses PostgreSQL. Live tenant credentials, subscriptions
and application acceptance remain pending. See [Lark integration](channels/LARK.md).


TypeScript scope update (2026-09-15): candidate.94 adds declarations for the
Capability/Dispatcher and HTTP server/client module entries, plus structural error
and Task admission types. A separate tarball consumer compiles under strict
NodeNext and executes its emitted program. Root and full Agent/Task/Peer module
coverage remain pending; see capabilities/TYPES.md for the exact supported imports.


Package identity update (2026-09-15): candidate.93 uses internal npm version
`0.1.0-candidate.93` and its version-qualified tarball filename. `CORE_RELEASE`
reports the installed package identity. The release gate includes an ordinary
candidate.92 → current npm upgrade with the same cache, lockfile and node_modules.
See releases/IDENTITY.md. This does not complete the separate public TypeScript
surface request or prove application integration.


Current scope addition (2026-09-15): IM is a replaceable User Assistant interface.
The channels module adds a durable inbox, explicit cross-channel account binding,
Core task controls and notification projection, with Telegram/Slack text normalizers.
The local file module adds authorized UTF-8 read/create and original receipts;
existing browser tools cover host-bound form entry. See channels/README.md and
examples/core-assistant-channels. Real IM authentication/delivery installations,
a remote device transport and general desktop control remain application work.


A headless JavaScript framework for AI Native Applications: configure an Agent's responsibility and resources, give it a goal, let it use authorized capabilities, and retain work and results beyond a chat connection.

This is the **0.1.0 public source candidate**, published at https://github.com/alextiannus/iaic-core. A reuse license has not yet been selected; public visibility does not imply an MIT or other open-source license grant. See [ACCEPTANCE.md](ACCEPTANCE.md) for the current requirement-to-evidence map and [STATUS.md](STATUS.md) for the chronological implementation record.

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
npm test                     # module checks and standalone examples
npm run verify:core-package  # pack, install elsewhere, run examples there
npm pack                     # create a reusable Core npm archive
```

The full test suite and package verification also require a running Docker daemon and the pinned image above for actual sandbox execution.

An application installs the resulting `.tgz` and imports `@immedi/iaic-core` or a module subpath. It does not import a platform server or copy Core into every application. See [GETTING_STARTED.md](GETTING_STARTED.md).

Independent-principal communication is available as the optional [Peer collaboration module](collaboration/peer/README.md), with a [runnable composition](examples/core-peer-collaboration/README.md).

The optional [User AI Assistant demo](examples/core-user-assistant/README.md) shows
private resources, clarification and user-authorized declaration submission, with a
system-model server and a minimal terminal client.

## Basic modules

| Need | Modules and contracts |
| --- | --- |
| Simulate local Agent work | [Local simulation](developer/SIMULATION.md): scripted models, scoped tools and original response-loss receipts |
| Develop and migrate an application | [Developer tools](developer/README.md): CLI, independent starter and versioned PostgreSQL migrations |
| Manage accounts and organizations | [Accounts](accounts/README.md): replaceable directory, memberships and current identity mapping |
| Record money and execute payments | [Payments](payments/README.md): confirmed invoice sources, charge/refund intents, provider adapters and reconciliation |
| Resolve subscription access | [Subscriptions](subscriptions/README.md): versioned plan snapshots, current periods and entitlements |
| Deliver background results | [Notifications](notifications/README.md): durable queue, channel ports, attempts and reconciliation |
| Evaluate capability changes | [Evaluation](evaluation/README.md): independent grading, complete case coverage, baselines and evidence |
| Observe running releases | [Observation](observation/README.md): trusted metrics, fixed policies and atomic protective rollback |
| Select evaluated releases | [Releases](releases/README.md): immutable version bindings, canary selection, stop and rollback |
| Store binary resources | [Object storage](storage/README.md) and [release resource loading](releases/README.md): scoped content references and verified files |
| Observe and control a browser device | [Devices](devices/README.md): host-owned Page adapter, current policy and persistent action receipts |
| Execute released code | [Execution](execution/README.md): pinned Docker sandbox, resource loading and shared code capability |
| Describe executable operations | [Capabilities](capabilities/README.md): schemas, authorization, functions or Agent implementations, result verification |
| Persistent work and model loop | [Agent](agent/README.md), [Tasks](tasks/README.md), [Context](context/README.md) |
| Configure jobs and long-lived work identity | [Identities](identities/README.md): `AgentRegistry.register`, host JSON configuration, revision-bound tasks |
| Remember, reference and produce | [Memory](memory/README.md), [Knowledge](knowledge/README.md), [Workspace](workspace/README.md) |
| Discover installed working methods | [Skills](skills/README.md): selected catalogs and progressive reads |
| Route and bound model requests | [Explicit routing](assistants/ROUTING.md), [shared concurrency](agent/CAPACITY.md), [request/Token rates](agent/RATES.md), [currency estimates](costs/README.md) |
| Clean expired current resources | [Retention](resources/RETENTION.md): opt-in bounded Memory/Knowledge cleanup and version tombstones |
| Choose a model and account for use | [Assistants](assistants/README.md), [Credentials](credentials/README.md), [Billing](billing/README.md) |
| Continue conversations and proactive work | [Sessions](sessions/README.md), [Deferred](deferred/README.md), [Events](events/README.md), [Triggers](triggers/README.md), [Recurring](recurring/README.md) |
| Authorize and cooperate | [Mandates](mandates/README.md), [Handoffs](handoffs/README.md) |
| Connect an external Agent | [A2A](a2a/README.md), [MCP](mcp/README.md), [HTTP API and remote SDK](http/README.md), ordinary ESM interfaces |

Each module owns its state and documents its injected dependencies. [Assistant work composition](assistants/TASKS.md) combines these ports without another Runtime or container framework.

## Application boundary

Core provides basic capabilities, interfaces and necessary runtime rules. Applications own authenticated identity mapping, business truth and calculations, capability implementations, installed Skill code, configuration storage/distribution, resource-sharing policy, service deployment and UI/UX.

Core prioritizes **Platform AI capabilities**, implemented by a team of a built-in
Agent driven by the system model and the current external Codex Agent. Shared
tasks, work artifacts and feedback support mutual takeover and reciprocal review; they are complementary
participants in the same role. Codex need not adopt Core Runtime. The team still
needs platform-side capabilities for development, evaluation and release; the
existing CLI and evidence tools alone do not complete this integration.

**User Assistant AI foundations** remain the next priority.
User Assistants may be application-provided or external third-party Agents.

Business AI is application-resident, using system model configuration and
system/server capabilities to fulfill the application's business responsibilities.
Core only supplies cross-application Business AI capabilities where useful; a
built-in Business AI product is not required. Task length and complexity do not
determine responsibility. See [design and delivery requirements](CORE_REQUIREMENTS.md).


Default long-lived resource scoping should distinguish user plus organization. Applications can explicitly share company resources or configure a shared job. A shared resource scope does not automatically grant access to every member's Task history. A personal external Agent can call authorized capabilities without adopting Core Runtime.

## Source and validation

[SOURCE.json](SOURCE.json) records the source revision and hashes of extracted files. The candidate includes Core modules and neutral examples only; private application implementations, credentials, production data and private Git history are not included. Some inherited module notes refer to historical integration locations; those are context, not runtime dependencies or files required by this candidate.

Core-only module checks now live in `test/` and run with `npm run test:modules`; application-coupled integration suites remain in the application repository. Each check imports the Core package directly. The independent CI runs module checks and the standalone examples from a fresh package installation. These checks establish the documented composition contracts; they do not establish universal model quality or completion of every AI Native Application requirement.

The complete delivery target and acceptance conditions are tracked in [CORE_REQUIREMENTS.md](CORE_REQUIREMENTS.md). Current usability does not imply that all conditions are satisfied.

Every Platform AI Team member maintains system documentation for its changes and
reviews its peer's documentation alongside code. Superseded versions have finite
[version lifetimes and migration instructions](VERSION_LIFECYCLE.md). A User
Assistant AI Demo is not a Core deliverable or acceptance requirement.

A minimal [Platform Team host](examples/core-platform-team/README.md) assembles the
existing modules with a system model, separate development allowance, shared work
and reciprocal reviews. It accepts work requests from either member and retains
requester/executor provenance. A real system-model/Codex review, correction and
reciprocal-review loop has also completed; see the host evidence below. Arbitrary
external takeover of an interrupted native Task remains unfinished.
