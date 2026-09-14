# Core delivery objective

The active objective is to complete IAiC Core's foundational capabilities and satisfy the technical scope and acceptance criteria of the user-approved Note 30, "IAiC Current Design and Core Principles". ImmediToday is an integration example, not the release objective or a substitute for framework acceptance. Later user clarification keeps the framework headless and modular: business rules and UI belong to applications; roles describe responsibility rather than mandatory classes. Platform AI and User Assistant AI can be application-provided or external third-party Agents. Business AI is application-resident and uses system model configuration and system/server capabilities. Internal Agents can share Core Runtime; external Platform/User Agents need not adopt it.

Public availability is already achieved. Licensing is undecided and does not block engineering. Usable foundations are milestones; the full objective remains incomplete.

## User-approved scope change — 2026-09-14

User Assistant BYOK switching is retained as an existing optional capability, but further BYOK feature development and dedicated testing are paused. It is no longer required technical design or an acceptance prerequisite for Core. The required User AI Assistant paths are the platform-configured default model and a user's personal external AI assistant accessing application capabilities through existing identity and authorization. External inference is owned by that assistant; explicitly invoked platform inference still follows platform allowance and usage attribution rules. Existing BYOK code and historical evidence remain preserved; this change does not remove credentials or change running model configurations.

## Latest user clarification: delivery priority and residence

Build **Platform AI capabilities first**: shared capability/Skill/code discovery
and maintenance, execution resources, runtime feedback, candidate evaluation,
release, observation and rollback. Applications may supply Platform AI themselves
or connect external third-party Agents such as Codex. External coding/inference
capability does not replace the platform-side capabilities Core must provide.

Provide **User Assistant AI foundations and a generic demo** using the existing
configured-jobs example and Agent template: Memory, Knowledge, Skill loading,
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
2. Platform AI capabilities support application-provided or external third-party development/evolution Agents. User Assistant foundations support persistent work and a generic demo, with application-provided or external access. Core need not ship a Business AI implementation; applications that use Business AI host it internally with system model configuration and system/server capabilities. Shared persistent identity/resources and task continuity remain framework capabilities.
3. UI bindings, SDK, HTTP, MCP and A2A preserve the same Capability permissions, effects and result semantics. Exercise the same contract through the implemented surfaces, including denied access and durable receipts.
4. Crashes, pauses, timeouts and unknown external results recover or reconcile without blind duplicate effects. Verify durable state and external effects across actual interruption boundaries.
5. Delegation does not widen permissions or exceed budgets; artifact references survive and cancellation propagates. Include failed-child takeover evidence.
6. Model, Tool, Skill and Prompt changes pass capability/regression evaluations; bad releases can be stopped and rolled back. Demonstrate the reusable framework release path, not only this repository's CI.
7. Generic application services run with defaults or existing-system adapters without transferring domain data ownership. Demonstrate replacement and independent module use.
8. Autonomous actions are traceable to their authorization, and revocation stops later execution. Preserve evidence of Permission/Mandate/Policy decisions and current checks.

Continue capability construction first, then necessary hardening and the full acceptance checks. Do not lower acceptance criteria, recast missing services as application-only responsibilities, or replace missing abilities with reports and repeated tests of already-proven paths. Current implementation and practical gaps are recorded in STATUS.md.
