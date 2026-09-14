# Note 30 acceptance evidence map

Phase one is the minimum runnable Core described in CORE_REQUIREMENTS.md. The full
Note30 evidence matrix below remains a roadmap and record, not an assertion that
every advanced case must finish before phase-one release. Three Demo Projects
and community collaboration are phase two.

2026-09-14 user-approved scope update: User Assistant BYOK remains optional and retained; related feature development and dedicated testing are paused. BYOK switching is not a Core technical-design or completion requirement. The required paths are the platform default model and personal external AI assistants using existing identity/authorization. Historical BYOK implementation/test records below do not reinstate it as a gate. See CORE_REQUIREMENTS.md.

Review date: 2026-09-14. Runtime evidence baseline:
`f37c9ec302039aaabfa1dbdf820ffdb6371d8302`, exact-source CI
[34779735270](https://github.com/alextiannus/iaic-core/actions/runs/34779735270).
This evidence baseline was candidate.73. Later template integrations and releases
are recorded in `STATUS.md`.
This is a requirement-to-evidence review, not a new gate that declares all tests
sufficient, and not a percentage-complete estimate. Note 30 and
[CORE_REQUIREMENTS.md](CORE_REQUIREMENTS.md) retain their full scope.

`STATUS.md` is a chronological development record. Earlier statements of missing
capabilities must be read alongside their subsequent implementations. The rows
below distinguish implemented mechanisms from remaining acceptance evidence.

| Note 30 condition | Evidence inspected | What it establishes / remaining limit |
| --- | --- | --- |
| 1. Compose a new authorized goal without a dedicated Feature | [Actual composition](examples/core-real-composition/README.md), [continuity](examples/core-real-continuity/README.md), [delegation](examples/core-real-delegation/README.md) | Actual models have composed source/Skill/Memory/Workspace operations and completed independently checked artifacts. Successes and failures are retained. Authored cases do not establish statistical reliability or independent held-out coverage. One post-freeze combination goal passed the unchanged grader; see below. |
| 2. Platform AI capabilities and persistent User Assistant foundations; application-owned Business AI | [Configured jobs](examples/core-configurable-jobs/README.md), [Agent template](developer/templates/agent/README.md), [recurring monitor](examples/core-recurring-monitor/run.mjs), [Agent registry](identities/registry.js) | Persistent identity/configuration, closed Sessions, separate worker execution, model binding and proactive monitoring are demonstrated. Actual delegation uses two distinct persistent identities. Latest user scope requires Core Platform AI to combine a built-in system-model Agent and external Codex as one team. User Assistant foundations support application-provided or external assistants. Business AI resides in the application with system models/resources and need not be delivered as a Core implementation. These existing examples support shared mechanisms, not certification of production availability or completion of the Platform AI team: bidirectional built-in/external handoff, mutual takeover, returned evidence and reciprocal review remain to be demonstrated. |
| 3. Shared UI/SDK/API/MCP/A2A semantics | [Function parity](examples/core-protocol-parity/README.md), [persistent Task surfaces](examples/core-agent-surfaces/README.md), [browser UI bindings](examples/core-ui-bindings/README.md) | One stable function request has one domain effect across five entries, with denial and unknown-response semantics. Task controls share original receipts and current results. A real Chrome UI fixture proves same-Task SDK continuation and clarification. These tests cover implemented contracts, not every protocol feature or identity vendor. |
| 4. Recover/reconcile interruption without blind duplicate effects | [Execution recovery](examples/core-execution-recovery/run.mjs), [transition receipts](tasks/transition-requests.js), [delegated-task interruption tests](test/iaic-delegated-tasks.integration.test.js), [usage reconciliation](examples/core-usage-reconciliation/run.mjs) | Actual SIGKILL cases retain original effects/receipts; recovery uses current state and reconciliation. Unknown inference/effects are not assumed absent or blindly replayed. Infrastructure loss and arbitrary providers are not universally covered. An older real-provider unknown-usage sample remains unresolved; a later settled run does not erase it. |
| 5. Delegation scope, budgets, artifacts, cancellation and takeover | [Delegated-task tests](test/iaic-delegated-tasks.integration.test.js), [same-owner actual model](examples/core-real-delegation/README.md), [handoffs](handoffs/README.md) | Deterministic integration includes cross-principal grants, cancellation and original-effect takeover after a child SIGKILL. Actual-model same-owner collaboration passes 16 checks with automatic parent continuation. Cross-principal actual-model operation is not claimed; no universal remote orchestration claim follows. |
| 6. Evaluate changes and stop/roll back bad versions | [Evaluation example](examples/core-evaluation/run.mjs), [release pipeline](examples/core-releases/run.mjs), [release binding tests](test/iaic-releases.integration.test.js), [scheduled monitor](examples/core-recurring-monitor/run.mjs) | Capability/regression gates reject failed evidence; immutable versions, checked executable resources, Docker execution, observation-driven stop/rollback and released-Agent fences run independently of repository CI. A concrete changed-prompt candidate now has separate actual-model capability/regression suites bound to the [evaluated-release consumer](examples/core-evaluated-release/README.md), checked resources and a PostgreSQL stop/rollback drill. Post-release inference and production observation are not performed by that consumer; Runtime-stop and monitoring evidence remain separate. The generated Agent template also accepts an optional evaluated-release binding; its installed integration exercises reconstruction, stop during a model response and newly admitted fallback work. |
| 7. Replaceable defaults without transferring domain ownership | [Accounts](accounts/README.md), [adapter substitution test](test/iaic-accounts.integration.test.js), [payments](examples/core-payments/run.mjs), [module catalog](README.md#basic-modules) | Default generic stores and services run independently; an existing-system directory adapter is exercised with current revocation. Invoice facts come from a host-owned confirmed source; payment response loss reconciles without duplicate capture. A provider-specific login/payment UI is not a Core prerequisite. Applications retain domain facts and invariants. |
| 8. Explainable authorization and revocable later execution | [Mandates](mandates/README.md), [execution policy](capabilities/POLICY.md), [policy integration](test/iaic-execution-policy.integration.test.js), [template Mandates](developer/templates/agent/README.md#optional-standing-authorization) | Current Permission, persistent Mandate source/terms and recorded Policy revision/reason are distinct. Mid-response revocation blocks subsequent writes; denied scheduled work is blocked before admission. Recording is a required port when ExecutionPolicy is enabled; hosts still own audit durability/access and must actually wire their chosen policies. A library alone cannot prove every deployed application records every autonomous action. |

## Scope of retained evidence

The baseline CI runs module checks, typed client checks and 42 independently
installed examples. It does not run paid samples or real Chrome UI checks.
Relevant private practice evidence is retained under
`/Users/immedi/Documents/ImmediToday-evidence/`:

- `2026-09-14/core-real-delegation`: frozen inputs, actual result/history,
  exact-source CI and package evidence; 16/16, 29,784 Provider Tokens, no pending
  usage. Runtime reconstruction is orderly, not SIGKILL.
- `2026-09-14/core-real-planning`: actual-model Session/Memory/plan continuity;
  13/13 under its recorded configuration, 149,411 Provider Tokens, no pending usage.
- `2026-09-14/core-ui-bindings/installed-browser.log`: real Chrome/152.0.7977.83,
  one domain effect, same Task/clarification/current revocation; fixture model.
- `2026-09-14/core-starter-mandates`: first failed scheduling-state check and its
  fix, successful package check, source and release asset verification.
- `2026-09-14/core-execution-policy`: durable Policy record/revocation checks.

These directories contain synthetic test data, not a transferable production
authorization or a public credential package. Original actual-model failures and
unknown-usage snapshots remain part of the record. Their persistence does not mean
all historical incidents have been reconciled.

## Post-freeze combination goal

The already installed baseline and unchanged core-real-composition program were
used for a new `combined-queues` case authored after implementation freeze: combine
South dispatchable records with North held-and-ready records, de-duplicate and
apply the existing memory ordering. The dataset/expected result were saved before
inference; sources, Skill, tools, grader and the 10-turn/8-tool/batch-4 bounds were
unchanged. This is a post-freeze authored goal, not third-party blind validation.

Actual DeepSeek V4 Flash run `da7cbedc-2c3b-4450-aa07-5248705d9c08` passed all seven
original checks. Task `9700470e-f2f1-42cb-bf70-957a7483182e` succeeded with IDs
R-03/R-02 and total 11; the saved artifact was read back. Six model requests and
eight Tool attempts used 19,116 input plus 4,649 output Tokens (23,765 total).
Unknown usage and reserved units were zero. Fixture allowance settlement was
23,765 platform units under the explicit 1:1 rule. Source/Workspace reads were
repeated, but there was one write and no paid retry or grader adjustment.
Evidence: `2026-09-14/core-frozen-goal` under the private practice evidence root.

This closes the specific post-freeze goal demonstration. It does not establish
statistical reliability or independently curated held-out coverage. Do not keep
repeating the same selection sample without a new unresolved requirement.

## Remaining work order

Prioritize the built-in system-model Platform Agent plus external Codex team and its shared task/result flow, then the User Assistant foundations,
according to CORE_REQUIREMENTS.md. Application-specific Business AI is optional
for Core delivery; when used it is resident in the application.

1. Close the domain-by-domain technical acceptance review and fix actual omissions.
   Preserve separate evidence for runtime recovery, protocol parity and application
   ownership rather than requiring every check to invoke an LLM again.
2. Verify independent Core consumption and the missing framework conditions using
   the relevant module/composition evidence. Note 43 makes Core the deliverable;
   ImmediToday's complete upgrade, report quality and submitter acceptance remain
   separate application work, not prerequisites for Core foundation delivery.
   Existing application failures remain failures. Core examples and local release
   drills do not establish production business acceptance, and application health
   does not establish all eight framework conditions.

The local evaluation-to-release evidence chain is recorded in
`2026-09-14/core-real-release`: four actual evaluation snapshots across distinct
capability/regression suites, one concrete prompt candidate, checked package and
configuration resources, rejected mismatched/failed evidence, current stopped
binding checks, and one original rollback receipt recovered after reconstruction.
The baseline capability snapshot is reused without repeating its inference.
The three new model runs used 62,609 Provider Tokens with no unknown reservations.
The injected startup-failure fixture and authorized rollback drill are explicitly
separate from the actual-model results. No post-release inference or production
deployment is inferred from this exercise.

Do not add unbounded requirements for every LLM, identity vendor, cloud provider,
UI framework or protocol extension. Equally, do not reinterpret existing module
ports, fixture results or authored model samples as complete application delivery.


Platform peer-review mechanism evidence: [review contract](collaboration/REVIEWS.md)
and [installed Runtime/MCP composition](examples/core-peer-reviews/README.md) retain
reciprocal findings under separate identities, exact artifact revisions and linked
follow-ups, including a revision whose author changes when a teammate covers the
edit. This does not prove actual task takeover, real model review quality or a live
Codex connection. Documentation ownership and finite [version lifetimes](VERSION_LIFECYCLE.md)
are current team responsibilities. User Assistant AI Demo is not required.


[Platform Team host composition](examples/core-platform-team/README.md) now combines
the system model, isolated platform-development allowance, shared artifacts and
reciprocal reviews with persistent native Tasks. The deterministic installed check
retains requester/executor identities, survives reconstruction and proves that
personal allowance is not borrowed for platform inference. This narrows the
integration gap; real-model collaboration and external member takeover of a
persistent team Task are still unverified.


## Note47 additive peer slice — 2026-09-14

Evidence: test/iaic-peer-collaboration.integration.test.js (seven PostgreSQL tests)
and examples/core-peer-collaboration/run.mjs (also installed-package verification).

| Note47 coverage | Current evidence |
| --- | --- |
| AC01–04 identities, denial, revocation, expiry | Trusted binding port with synthetic independent identities; current grant and endpoint checks |
| AC05–08 dedup/order, no implicit facts, explicit formal action | Concurrent stable request, stale subject/sequence rejection, ordinary-message zero writes, dispatcher-only sample write |
| AC09–12 information, Unknown, human, evidence | Targeted minimal fields, original-effect query after lost response/SIGKILL, owner resolution, source/hash/revocation and reference-only messages |
| AC13 protocol surfaces | Actual loopback HTTP; in-process MCP and official A2A SDK mapping, shared logical message and stable conflict code |
| AC14 existing regressions | Existing repository CI module/package gates remain required before release |
| AC15 consuming 12Eat integration | Not executed; cannot be substituted by Core fixtures |

These are bounded implementation checks, not blanket acceptance of every clause.
Production identity proof, host retry scheduling/backoff, source authority integration,
retention cleanup and actual application/domain adapters require consuming-host work.
Information cancellation/reference-only structured requests are not implemented.
No real-model evaluation, full protocol conformance or all crash boundaries are claimed.


Peer recovery review (candidate.89): three additional regression scenarios reproduce
and fix blocked receipt recovery after evidence withdrawal/query-only transport,
expired human-create replay and starvation behind 50 retryable failures. The peer
integration file now contains ten tests. These strengthen the bounded recovery
evidence without changing the remaining Note47 application acceptance scope.
