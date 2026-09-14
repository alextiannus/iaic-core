# Core delivery objective

The active objective is to complete IAiC Core's foundational capabilities and satisfy the technical scope and acceptance criteria of the user-approved Note 30, "IAiC Current Design and Core Principles". ImmediToday is an integration example, not the release objective or a substitute for framework acceptance. Later user clarification keeps the framework headless and modular: business rules and UI belong to applications; roles describe responsibility, not mandatory classes or Runtime placement. Internal Agents can share Core Runtime; personal external Agents and external Codex do not need to adopt it.

Public availability is already achieved. Licensing is undecided and does not block engineering. Usable foundations are milestones; the full objective remains incomplete.

## User-approved scope change — 2026-09-14

User Assistant BYOK switching is retained as an existing optional capability, but further BYOK feature development and dedicated testing are paused. It is no longer required technical design or an acceptance prerequisite for Core. The required User AI Assistant paths are the platform-configured default model and a user's personal external AI assistant accessing application capabilities through existing identity and authorization. External inference is owned by that assistant; explicitly invoked platform inference still follows platform allowance and usage attribution rules. Existing BYOK code and historical evidence remain preserved; this change does not remove credentials or change running model configurations.

## Design responsibility and composition — Note 43 alignment

Start with whose responsibility the goal represents and what evidence establishes
completion. Then compose capabilities, working methods, persistent resources and
the execution/feedback loop. Task duration, complexity, business-object names and
proactive behavior do not classify an Agent.

| Use | Responsibility | Example |
| --- | --- | --- |
| User Assistant AI | Work on behalf of a user or organization, including ongoing job duties and their own business methods | A merchant chooses a stocking plan using margin and staffing constraints |
| Business AI Agent | Fulfill the application's own business responsibilities and handle exceptions in accepted work | The platform progresses an accepted order and resolves a fulfillment exception |
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
2. User, Business and Platform uses operate as persistent working subjects, with identity, resources, goals and work surviving a connection. No requirement for three role classes or three internal deployments.
3. UI bindings, SDK, HTTP, MCP and A2A preserve the same Capability permissions, effects and result semantics. Exercise the same contract through the implemented surfaces, including denied access and durable receipts.
4. Crashes, pauses, timeouts and unknown external results recover or reconcile without blind duplicate effects. Verify durable state and external effects across actual interruption boundaries.
5. Delegation does not widen permissions or exceed budgets; artifact references survive and cancellation propagates. Include failed-child takeover evidence.
6. Model, Tool, Skill and Prompt changes pass capability/regression evaluations; bad releases can be stopped and rolled back. Demonstrate the reusable framework release path, not only this repository's CI.
7. Generic application services run with defaults or existing-system adapters without transferring domain data ownership. Demonstrate replacement and independent module use.
8. Autonomous actions are traceable to their authorization, and revocation stops later execution. Preserve evidence of Permission/Mandate/Policy decisions and current checks.

Continue capability construction first, then necessary hardening and the full acceptance checks. Do not lower acceptance criteria, recast missing services as application-only responsibilities, or replace missing abilities with reports and repeated tests of already-proven paths. Current implementation and practical gaps are recorded in STATUS.md.
