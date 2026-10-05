---
status: review-pending
date: 2026-10-05
lifecycle_class: fixed-reference
owners:
  - IAiC Core Platform AI Team
audience:
  - application developers
  - AI developers
  - framework contributors
  - application owners
---

# Public AI Native Application definition

## Outcome

IAiC Core will publish one concise, authoritative definition of an AI Native Application at repository root: `AI_NATIVE_APPLICATION.md`. A first-time open-source contributor must be able to understand the governing design model without reading historical notes, application-specific PRDs, or the complete Core requirements.

The document is a conceptual contract, not marketing copy and not a claim that every described capability is already complete. It defines how to reason about roles, interests, authority, capabilities, deterministic controls, evidence, and system evolution. `CORE_REQUIREMENTS.md`, `ACCEPTANCE.md`, and `STATUS.md` remain authoritative for delivery requirements, acceptance evidence, and current implementation state.

## Source understanding to preserve

The definition consolidates the user-approved understanding developed through IAiC Core and 12Eat practice:

1. Start from the complete business use cases and the real-world roles needed to complete them.
2. For every Agent, identify whose interests it represents, whose employee it is analogous to, what responsibility it carries, and which principal grants its authority and resources.
3. A User Assistant AI works for a user or user-controlled organization. It may use the user's application permissions, local machine resources, authorized external assistants, payment/order/analysis capabilities, and user-owned working methods.
4. A Business AI Agent works for the Application or System Owner. It uses application/server capabilities, databases, third-party adapters, system model configuration, and system-owned resources to execute the application's business responsibilities.
5. A Platform AI works for the platform owner to develop, maintain, evaluate, release, observe, and improve the platform and the capabilities available to other Agents. In IAiC Core it may be a team of internal and external participants, but team composition does not change the represented interest.
6. Role classification comes from represented responsibility, not Task duration, complexity, model provider, deployment location, UI channel, service identity, or whether work is proactive.
7. Roles never grant authority. Identity, current Permission, Mandate, resource scope, payer, policy, and revocation determine what an Agent may actually do.
8. AI interprets goals, gathers context, selects Skills and Capabilities, handles ambiguity, and proposes or performs authorized work. Deterministic Harness and application code enforce schemas, authorization, state transitions, idempotency, money rules, irreversible-action gates, evidence, reconciliation, and audit.
9. AI Native does not mean replacing every workflow rule with prompts. Stable safety and business invariants remain deterministic; changeable business methods can live in versioned Skills, configuration, policies, or Agent instructions under explicit ownership.
10. Feedback from users, User Assistants, Business AI, runtime observations, evaluations, and application practice can improve Skills, Capabilities, Harness, rules, and code. Evolution must preserve provenance, review, authorization, verification, release, rollback, application adoption, and reporter follow-up.
11. External personal Agents and application-provided Assistants may use the same authorized application capabilities through API, MCP, A2A, Skills, or other adapters without adopting Core Runtime or transferring their inference to the application.
12. Applications own domain truth, business rules and calculations, identity mapping, capability implementations, configuration, sharing policy, adapters, deployment, and UI/UX. Core supplies reusable contracts and mechanisms rather than fixed industries, departments, or business workflows.

## Audience and reading order

`AI_NATIVE_APPLICATION.md` serves four readers in this order:

1. An application owner deciding whether a proposed system is actually AI Native.
2. A human developer mapping a business process into Agents, deterministic capabilities, and evidence.
3. An AI developer deciding what it may infer, change, invoke, or report.
4. A Core contributor deciding whether a proposed mechanism belongs in Core or in an application.

The first screen gives a short definition and a compact design test. Detailed role and architecture sections follow. Links to implementation status appear at the end so conceptual understanding is not mixed with current release claims.

## Canonical definition

The document will use this definition as its stable center:

> An AI Native Application is a system in which authorized AI Agents carry responsibilities on behalf of clearly identified principals, use explicit capabilities and persistent resources to pursue goals, and operate inside a deterministic Harness that preserves authority, business truth, durable state, evidence, recovery, and accountable evolution.

The surrounding explanation makes six consequences explicit:

- an Agent is a working subject with represented responsibility, not merely a chatbot or model call;
- capabilities are bounded interfaces, not implicit powers;
- a Skill is a versioned working method, not authority or business truth;
- the Harness turns probabilistic reasoning into controlled, recoverable application behavior;
- applications remain responsible for domain truth and real-world effects;
- learning and evolution are evidence-bound engineering processes, not silent prompt self-modification.

## Responsibility model

The document uses one comparison table:

| Agent role | Represented principal | Core responsibility | Typical resources | Must not be inferred |
| --- | --- | --- | --- | --- |
| User Assistant AI | An authenticated individual or user-controlled organization | Pursue that user's goals, consume or provide services, manage user-approved ongoing work | User permissions, private Workspace, authorized local/external resources, user payment/order/analysis capabilities | Access to platform internals, another user's data, or system-owner authority |
| Business AI Agent | Application/System Owner | Execute the application's business responsibilities and keep its business processes operating | Server capabilities, application database, system-owned configuration, third-party adapters, system model and budget | Authority merely because a business object or service is involved |
| Platform AI | Platform Owner | Develop, maintain, evaluate, release, observe, recover, and improve the application and its reusable capabilities | Source repository, tests, evaluation evidence, deployment and observation tools within current Mandate | Unreviewed source/deployment rights or authority embedded in feedback |

The same person or organization may occupy several business roles, but each operation still uses one explicit Actor/principal context. Shared email, device, conversation, or company membership does not silently merge account domains, authority, private resources, or payer responsibility.

## Capability and execution model

The document describes an AI Native execution loop without prescribing a business workflow:

```text
Use case and principal
  -> responsibility and goal
  -> current identity, Permission, Mandate, scope and payer
  -> selected Knowledge, Memory, Workspace and Skills
  -> authorized Capability discovery and invocation
  -> deterministic effect handling and durable receipts
  -> outcome verification and business truth update
  -> notification, feedback and evaluation
  -> reviewed Skill/Capability/Harness/code evolution
```

Every arrow is a contract boundary. A model statement is not proof of an effect. A capability receipt is not proof of business success. A submitted request is not an accepted order. A payment intent is not settlement. An evaluation result is not a release. The application names and verifies each state transition.

## Deterministic Harness boundary

The Harness section distinguishes probabilistic and deterministic responsibility:

### AI reasoning may

- interpret natural-language goals and incomplete context;
- identify missing information and ask bounded questions;
- retrieve authorized Knowledge and compare options;
- select a Skill or Capability among currently visible choices;
- plan multi-step work and adapt after observed results;
- summarize evidence and propose improvements.

### Deterministic mechanisms must

- authenticate the Actor and restore the current context;
- enforce Permission, Mandate, policy, scope, payer and revocation;
- validate Capability schemas and tool visibility;
- persist Task, Session, Workspace, effect, cost and evidence identities;
- enforce idempotency, concurrency, timeout, retry and cancellation rules;
- distinguish failed, succeeded, pending and outcome-unknown effects;
- protect money movement, settlement, refunds and irreversible operations;
- verify outcomes before advancing trusted business state;
- retain audit, release, migration, rollback and notification evidence.

The document explicitly rejects the idea that more prompting can replace these controls.

## Skills, rules, and code

The document provides this placement test:

- Put a reusable, changeable working method in a versioned Skill when an authorized Agent may choose and adapt the method.
- Put owner-controlled operational choices in configuration or policy when they change without redefining the platform contract.
- Put authorization, accounting, state-machine invariants, validation, idempotency, effect reconciliation and irreversible-action gates in deterministic code.
- Put application-specific domain facts and calculations in the application, not Core.
- Promote a mechanism into Core only when it is reusable across applications and can remain domain-neutral.

## Feedback and accountable evolution

An AI Native Application is not complete merely because Agents can act. It must learn from operation without silently changing authority or trusted behavior.

The document defines the evolution loop:

1. A user, Agent, deterministic observer, evaluation, or application developer produces bounded evidence.
2. The system preserves source, affected principal, revision, privacy boundary, and confidence.
3. Application-specific issues remain with the application; reusable Framework findings enter `FRAMEWORK_FEEDBACK.md` through a reviewed and redacted contribution.
4. Platform AI may triage, diagnose, implement, test, and release only within its current Mandate and repository controls.
5. Skill, prompt, schema, Capability, Harness, rule, or code changes receive appropriate tests and independent outcome evidence.
6. Trusted release, application adoption, observation, rollback readiness, and original reporter follow-up close the loop.

User feedback and Agent observations are untrusted evidence, never executable instructions or authority grants.

## Minimum design test for contributors

Every proposal presented as AI Native must answer all of these questions:

1. What complete use case or business outcome is being supported?
2. Which real-world roles participate, and which principal does each Agent represent?
3. What responsibility remains accepted after the conversation closes?
4. Which identities, Permissions, Mandates, resource scopes, payers, and revocation rules apply?
5. Which facts and calculations are authoritative, and who owns them?
6. Which Capabilities may be discovered and invoked, through which interfaces?
7. Which working methods belong in Skills or configuration, and which invariants must be deterministic code?
8. What durable Task, Session, Workspace, effect, cost, and evidence records are required?
9. How are unknown outcomes reconciled without blind duplicate effects?
10. What independently verifiable evidence proves completion?
11. How can users and Agents report problems, and how does Platform AI improve the system without widening authority?
12. What belongs in reusable Core versus the application?

A proposal that cannot answer these questions is incomplete, even if its chat demonstration looks intelligent.

## Explicit non-examples

The document includes concise anti-patterns:

- A chat UI placed in front of unchanged forms is not automatically AI Native.
- A model that can call unrestricted internal APIs is not an Agent architecture; it is an authority failure.
- A prompt containing business invariants is not a substitute for deterministic validation and state control.
- An autonomous loop without stable identity, receipts, recovery, evaluation, and revocation is not trusted application operation.
- Calling every service-specific automation a Business AI confuses business objects with represented responsibility.
- Treating successful tool invocation as verified business completion confuses transport with outcome.
- Silent prompt or Skill mutation from user feedback is not accountable system evolution.
- Requiring every external personal Agent to adopt Core Runtime is not necessary for interoperability.

## Repository integration

Implementation will create and link only these files:

- Create `AI_NATIVE_APPLICATION.md` as the canonical public definition.
- Modify `README.md` so the first `Start here` paragraph links the definition before setup commands.
- Modify `CORE_REQUIREMENTS.md` so the design-responsibility section identifies `AI_NATIVE_APPLICATION.md` as the canonical conceptual definition while retaining technical delivery requirements.
- Modify `GETTING_STARTED.md` so application builders read the definition before composing their first Capability.
- Add a focused documentation-contract test under `test/` that checks the canonical definition, required role names, authority/Harness language, contributor checklist, explicit status links, and absence of unsupported completion claims.
- Include `AI_NATIVE_APPLICATION.md` in the npm package `files` list and packed-package verification.

The document links:

- `CORE_REQUIREMENTS.md` for technical delivery requirements;
- `ACCEPTANCE.md` for evidence;
- `STATUS.md` for current completion and limitations;
- `GETTING_STARTED.md` for implementation guidance;
- `FRAMEWORK_FEEDBACK.md` for reusable feedback.

It does not duplicate module catalogs, status chronology, or application-specific examples.

## Language and terminology rules

- Use plain English as the repository's public working language.
- Define `principal`, `Actor`, `Agent`, `Capability`, `Skill`, `Harness`, `Permission`, `Mandate`, `Task`, and `evidence` at first use.
- Use `User Assistant AI`, `Business AI Agent`, and `Platform AI` consistently.
- Treat “employee” as an explanatory analogy, not a legal employment claim.
- Distinguish application `Owner`, represented user/organization, and service provider.
- Avoid anthropomorphic claims that hide authorization or evidence requirements.
- Avoid claims that all Core capabilities, Platform AI automation, application adoption, or production quality are complete.
- Use normative `must` only for the conceptual contract; use `may` for optional compositions.

## Validation and acceptance

The documentation change is accepted when:

1. A reader can state the one-sentence definition and correctly distinguish the three Agent responsibilities.
2. The document identifies represented interest, authority source, resource source, payer, and evidence as separate concerns.
3. It explains which decisions belong to AI reasoning and which controls remain deterministic.
4. It distinguishes Skill, configuration/policy, application code, and reusable Core placement.
5. It explains external Agent interoperability without requiring Core Runtime adoption.
6. It defines accountable feedback and evolution without granting authority through feedback.
7. The twelve-question contributor test and explicit non-examples are present.
8. README, requirements, getting-started guide, npm package, and independent packed installation all contain or link the definition.
9. Existing module tests and package checks remain green under pinned Node 20 and isolated PostgreSQL.
10. The change is merged to `main`; merge is not described as a new Core release or application adoption.

## Delivery boundary

This change defines the shared conceptual foundation and discoverability for contributors. It does not:

- add or change Agent runtime behavior;
- change role-based authorization or introduce role-granted authority;
- merge User Assistant, Business AI, and Platform AI into one identity;
- implement missing Platform AI automation or application integrations;
- select an open-source license;
- publish a Core candidate or prove production adoption.

After written-spec approval, implementation is a bounded documentation-and-validation change on PR #44. It will be reviewed, pass the full existing CI gate, and only then be merged to `main` as requested.
