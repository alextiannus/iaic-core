# Core delivery objective

The active objective is to complete IAiC Core's foundational capabilities and satisfy the technical scope and acceptance criteria of the user-approved Note 30, "IAiC Current Design and Core Principles". ImmediToday is an integration example, not the release objective or a substitute for framework acceptance. Later user clarification keeps the framework headless and modular: business rules and UI belong to applications; roles are uses of one Runtime, not mandatory classes. External Codex may serve as Platform AI.

Public availability is already achieved. Licensing is undecided and does not block engineering. Usable foundations are milestones; the full objective remains incomplete.

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
| Model gateway | Multiple providers, per-Agent configuration, routing/capacity/failure policies, system keys/BYOK, attributable usage and costs |
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
