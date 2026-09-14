# Core delivery objective

Current user scope update (2026-09-14): a minimal reusable User AI Assistant demo
is now explicitly requested. It represents the authenticated user in declaration
submission and related clarification work, adapting AMC-MM companion behavior while
reusing Core Tasks, Memory, Workspace, Skills and system-model allowance. This
supersedes earlier no-demo statements below; it does not resume BYOK work or the
ImmediToday conversion. See examples/core-user-assistant/README.md.


2026-09-14 explicit goal correction: remove ImmediToday application conversion,
application production deployment and business evaluation from this thread goal.
The active deliverable is the minimum runnable IAiC Core Framework. Old ImmediToday
plans and evidence are historical references, not outstanding obligations here.
Three Demo Projects and community collaboration remain phase two.

## Current phase: minimum runnable Core

The latest user instruction makes phase one the delivery of a minimum runnable
Core Framework. Three Demo Projects and community collaboration are phase two,
not phase-one prerequisites. Stop report-draft, field-reference, publication-error
and model-feedback polishing; retain those as later application/community work.
Note30 remains the architectural reference, not a demand to finish every advanced
reliability case before this minimum release.

Phase one needs an independently installable modular Core, runnable native system
model and separate platform-development allowance, a basic real native/Codex work
and reciprocal-review loop with durable shared evidence, and usable setup/module
documentation including version lifetime and honest limitations. No User Assistant
Demo, three-project buildout or community-program work is required in this phase.

The longer-term objective is to complete IAiC Core's foundational capabilities and satisfy the technical scope and acceptance criteria of the user-approved Note 30, "IAiC Current Design and Core Principles". ImmediToday is an integration example, not the release objective or a substitute for framework acceptance. Later user clarification keeps the framework headless and modular: business rules and UI belong to applications; roles describe responsibility rather than mandatory classes. Core Platform AI is a team comprising a built-in Agent driven by a system-configured model and the current external Codex Agent. User Assistant AI can be application-provided or an external third-party Agent. Business AI is application-resident and uses system model configuration and system/server capabilities. Internal Agents can share Core Runtime; external Platform/User Agents need not adopt it.

Public availability is already achieved. Licensing is undecided and does not block engineering. Usable foundations are milestones; the full objective remains incomplete.

## User-approved scope change — 2026-09-14

User Assistant BYOK switching is retained as an existing optional capability, but further BYOK feature development and dedicated testing are paused. It is no longer required technical design or an acceptance prerequisite for Core. The required User AI Assistant paths are the platform-configured default model and a user's personal external AI assistant accessing application capabilities through existing identity and authorization. External inference is owned by that assistant; explicitly invoked platform inference still follows platform allowance and usage attribution rules. Existing BYOK code and historical evidence remain preserved; this change does not remove credentials or change running model configurations.

## Latest user clarification: delivery priority and residence

Build **Platform AI capabilities first**: shared capability/Skill/code discovery
and maintenance, execution resources, runtime feedback, candidate evaluation,
release, observation and rollback. For Core, implement Platform AI as a **team**:
a built-in Platform Agent driven by a system-configured model collaborates with
the current external Codex Agent. These are complementary participants in the
same Platform AI role, not alternative deployment choices. External coding
capability does not replace either the built-in participant or Core's platform-side
capabilities.

The built-in participant can continuously inspect authorized system context,
identify capability gaps, prepare improvement tasks and check returned outcomes.
Codex can handle architecture, complex implementation, code review, repository
work and release operations. These are useful defaults, not fixed job classes;
assign work according to capability, context and current authority.

**Mutual cover and reciprocal review are required.** Either participant can
originate work, execute authorized steps, request peer review and take over when
the other is paused, unavailable or unsuccessful. Default division of work must
not become a one-way observer-to-coder dependency. Both need access to the work
context and permitted development/evaluation tools needed for their assignments.

Use the existing task ownership/lease and effect receipts to hand off unfinished
work without repeating completed effects or treating unknown outcomes as absent.
Peer review covers plans, code/Skill changes and verification evidence; retain
review findings, revisions and follow-up results as shared artifacts. Either Agent
can review the other. This defines a collaboration capability, not a new human
approval UI or a requirement for two approvals on every atomic action.

Use shared goals, durable Tasks, Workspace/artifact references and retained
feedback for handoff, returned evidence and continued work. Reuse existing
Runtime, model, collaboration and protocol modules; do not create a second
scheduler or require Codex to adopt Core Runtime. Preserve distinct participant
identity, permission and usage attribution. The built-in Platform Agent uses its
system model profile and platform development budget, not a user's Assistant
allowance. External Codex retains its own provider/platform execution context.

The presence of both participants alone does not establish teamwork: demonstrate
bidirectional task handoff, result return, takeover and reciprocal review under the same goal.
This clarifies the existing persistent Platform AI condition, not a requirement
for more Agent role classes. Team composition is now required work; the previously
released CLI/evidence interfaces do not by themselves establish its completion.

Provide **User Assistant AI foundations and a minimal reusable demo**: Memory, Knowledge, Skill loading,
models, Workspace, Sessions, authorized capabilities, ongoing/proactive work,
platform allowance and external Agent access. Applications own specialized jobs
and UI. Both application-provided and third-party assistants are supported;
explicit BYOK switching remains paused.

**Business AI implementations belong to applications.** They reside in the
application and use its system model configuration and system/server resources.
Residence describes ownership and execution, not locally hosted model weights or
a mandatory separate process. Core may provide cross-application Business AI
capabilities where needed, or no built-in Business AI at all. Do not require an
order/fulfillment/content-production Agent product to complete Core. Shared
Runtime, model and execution modules remain available for applications to use.

This explicit user update supersedes the earlier requirement to deliver all three
Agent implementations within Core. The remaining generic capability domains and
acceptance conditions continue to apply; this is not evidence that they have all
been completed.

## Design responsibility and composition — Note 43 alignment

Start with whose responsibility the goal represents and what evidence establishes
completion. Then compose capabilities, working methods, persistent resources and
the execution/feedback loop. Task duration, complexity, business-object names and
proactive behavior do not classify an Agent.

| Use | Responsibility | Example |
| --- | --- | --- |
| User Assistant AI | Work on behalf of a user or organization, including ongoing job duties and their own business methods | A merchant chooses a stocking plan using margin and staffing constraints |
| Business AI Agent | Application-resident execution of its own business responsibilities using system model configuration and system/server capabilities | The platform progresses an accepted order and resolves a fulfillment exception |
| Platform Agent | Develop, maintain and improve the platform/application and its capabilities, Skills and code | External Codex changes the order capability, evaluates and releases the change |

The same order can be used by all three. A service identity does not by itself
make an Agent Business AI; an organization's shared assistant can represent its
users. Roles do not grant authority. Applications map each principal to current
permissions, Mandates, resource scope and payer. Closing a conversation does not
terminate the system's accepted business responsibility.

Core supplies modular working-subject configuration, Memory, Knowledge, Skills,
Workspace, Sessions, models, allowance, proactive work and execution interfaces.
Applications own domain facts/rules, business Skills, configuration storage,
identity/sharing policy and UI. Module independence means explicit interfaces,
dependencies and state ownership; it does not require separate deployments.
Personal external Agents use the same authorized capabilities through MCP/API,
optionally guided by installed Skills, without hosting their inference in Core.

Note 30 retains the complete capability map and eight acceptance conditions.
Note 43 makes independently usable Core capabilities the delivery priority.
ImmediToday report quality, submitter acceptance and its full application upgrade
remain application work, not prerequisites for Core foundation delivery or public
availability. Preserve their failures without converting them into passes or
adding new application-specific gates. Record nonblocking limits and continue
building the complete foundation; do not add a role-management product or fixed
business workflow to the framework.

## Required capability domains

| Domain | Required completion scope |
| --- | --- |
| Contracts and registry | Agent, Capability, Skill, Tool, event/result/adapter contracts; discovery, compatibility, implementation revisions and release binding |
| Agent Runtime | Persistent identity, responsibility/goals, resources, planning/execution, proactive work, model selection and outcome verification |
| Durable Harness | Run/step state, Session history, context reconstruction, checkpoints, leases, concurrency, retry, cancellation, timeout and reconciliation |
| Workspace, Memory, Knowledge | Artifacts, provenance, versioning, retrieval, scope/ACL, retention, correction/deletion propagation and cross-model continuity |
| Capability and Tool plane | Shared dispatch, domain interfaces, discovery, MCP/API import/export, usable results, device and code execution |
| Collaboration | Discovery, delegation/handoff, independent context, artifact references, progress, reduced permissions, budget, cancellation, failure takeover and A2A adaptation |
| Trust and governance | Identity/tenant ports, Permission, Mandate, Policy, credentials, sandbox, audit, risk, feature flags and kill switch |
| Model gateway | Multiple providers, per-Agent configuration, routing/capacity/failure policies, platform-managed credentials, attributable usage and costs |
| Application foundation | Replaceable defaults/ports for accounts, organizations/membership, subscriptions, allowance/metering/billing, payment/refunds, object storage, events and notifications |
| Evaluation and evolution | Datasets/environments, outcome and trace scoring, capability/regression evaluation, experiments, release/canary, observation, rollback and Platform Agent integration |
| Developer platform | SDK/CLI, local sandbox/simulator, contract/evaluation tools, templates, migration and deployment adapters; UI kit optional |
| Protocol surfaces | Typed SDK, HTTP, MCP server/client, A2A, webhooks/events and external Agent identity mapping |

## Acceptance evidence still required

All eight conditions below must be established before marking the objective complete. Existing deterministic tests, production integrations and small real-model samples are partial evidence; none alone proves this list.

1. An Agent achieves and verifies a new in-scope application goal by composing Skills/Tools, without a goal-specific pre-coded feature. Use held-out goals, actual models, independent outcome grading and preserved failures.
2. Core Platform AI combines a built-in system-model Agent and external Codex as a team, with bidirectional handoff, mutual takeover, returned evidence and reciprocal review. Platform capabilities support both participants. User Assistant foundations support persistent work, with application-provided or external access. Core need not ship a Business AI implementation; applications that use Business AI host it internally with system model configuration and system/server capabilities. Shared persistent identity/resources and task continuity remain framework capabilities.
3. UI bindings, SDK, HTTP, MCP and A2A preserve the same Capability permissions, effects and result semantics. Exercise the same contract through the implemented surfaces, including denied access and durable receipts.
4. Crashes, pauses, timeouts and unknown external results recover or reconcile without blind duplicate effects. Verify durable state and external effects across actual interruption boundaries.
5. Delegation does not widen permissions or exceed budgets; artifact references survive and cancellation propagates. Include failed-child takeover evidence.
6. Model, Tool, Skill and Prompt changes pass capability/regression evaluations; bad releases can be stopped and rolled back. Demonstrate the reusable framework release path, not only this repository's CI.
7. Generic application services run with defaults or existing-system adapters without transferring domain data ownership. Demonstrate replacement and independent module use.
8. Autonomous actions are traceable to their authorization, and revocation stops later execution. Preserve evidence of Permission/Mandate/Policy decisions and current checks.

Continue capability construction first, then necessary hardening and the full acceptance checks. Do not lower acceptance criteria, recast missing services as application-only responsibilities, or replace missing abilities with reports and repeated tests of already-proven paths. Current implementation and practical gaps are recorded in STATUS.md.


## Team documentation and finite version lifetimes

Every Platform AI Team participant owns complete documentation updates for the
changes it makes: concepts/architecture, module contracts and configuration,
operation and recovery instructions, acceptance evidence, known limitations and
migration guidance. Handoffs include changed document references and unfinished
documentation work. Peer review covers code and its documentation together. This
is an execution responsibility of every member, not a separate documentation Agent.

Each superseded version has a finite support lifetime, a successor, migration
instructions and an explicit end-of-support date. Preserve original evidence and
resolve in-flight effects; do not silently rewrite old tasks under new semantics.
Remove expired compatibility paths deliberately instead of distorting current Core
concepts to preserve every historical interface. See VERSION_LIFECYCLE.md for the
current candidate support window and deployment migration limitations.

The latest user instruction adds a minimal User Assistant AI demo as framework
composition evidence. It is not a mandatory UI product, and application-specific
Declaration contracts remain outside Core primitives.


## Automatic additive feedback upgrades — 2026-09-14

The user authorizes implementing reusable additive Core improvements from demo feedback
without another approval round. Inspect the latest active note, preserve frozen concepts
and module boundaries, implement the minimum usable mechanism, validate it, publish a
verified candidate and record evidence/limitations in the relevant notes automatically.
This does not redefine Agent roles, make a whole proposal a release prerequisite,
authorize arbitrary business effects or resume the removed ImmediToday work.

Note47 now has an optional independent-principal communication module under
collaboration/peer. Communication grants remain distinct from delegated execution;
formal submissions reuse CapabilityDispatcher and application-owned domain commands.
See its README and ACCEPTANCE.md for the implemented slice and remaining app evidence.
