# Capability and regression evaluation

This independent headless module runs application-owned datasets against an injected executor and independent grading port, keeps every scheduled case/repeat, and produces reusable outcome gates and regression comparisons. It does not embed an industry rubric, judge text quality with JSON schemas, or operate a production release automatically.

```js
const runner = new EvaluationRunner({
  execute: async ({input, revision, signal}) => runInYourEnvironment(input, {revision, signal}),
  grade: async ({testCase, observation}) => gradeOutcome(testCase, observation),
  onRecord: async ({runId, record}) => appendEvidence(runId, record)
});
const run = await runner.run({
  dataset: [{id: 'goal-1', category: 'planning', input: {goal: '...'}, expected: {/* grader facts */}}],
  revision: 'candidate-implementation-revision',
  graderRevision: 'approved-rubric-v1',
  environmentRevision: 'isolated-environment-v1', repeats: 3
});
const decision = evaluateGate(run, {
  minimumPassRate: 0.8, minimumMeanScore: 0.8,
  minimumCategoryPassRate: 0.5, requiredChecks: ['authorized', 'outcome_verified']
});
```

The example thresholds illustrate a host policy, not Core's final acceptance standard. Freeze dataset, grader and gate policy before evaluating a candidate. Keep development and held-out datasets distinct; the library does not certify their independence merely because different names are supplied.

## Execution and grading

Cases require unique `id`, `category` and JSON `input`; additional expected/rubric data reaches the grader only. Execution receives input, case/repeat/run IDs, implementation/environment revisions and AbortSignal. It receives no automatic expected answer or grader rubric. Supply plain JSON observations containing outcome, authoritative readbacks, artifact references, trace constraints and measured costs/latency/Token/tool errors as needed. Metrics are preserved as evidence, not converted into currency or platform allowance by this runner.

The grader returns `{passed:boolean, score:0..1, checks:[{name,passed}], ...evidence}`. Host scoring must distinguish outcome quality from shape validation, and can combine deterministic checks, rubric judges and human review. Exceptions in execution or grading remain failed records with their phase; no silent successful retry is added. A cancelled run retains cancelled records for remaining scheduled work. Required checks must be present and true in every record; category thresholds and all planned repeats are checked. Cancellation/incomplete coverage cannot pass even if rate thresholds are zero.

Execution is sequential by default. Host executors own isolated environments, model budgets, resource cleanup and real timeout enforcement; they must honor AbortSignal and account for unknown effects. Cancellation is cooperative, not a sandbox. The per-record callback is awaited and a sink failure stops the run. Durable job resume, replay of partially completed environments and distributed evaluation scheduling are not supplied here.

## Evidence and comparison

The run binds a digest of the complete dataset, implementation revision, grader/environment revisions, a case/repeat schedule and recorded observations/grades. `compareEvaluations(baseline,candidate)` requires equal dataset digest, grader/environment revision, repeat count and case coverage. It reports newly failed outcomes, lower scores and lost passing checks. It does not silently compare changed test sets or rewrite failures. Inspect the regression details and use the host's frozen release policy.

`FileEvaluationStore({directory})` stores complete run snapshots with canonical SHA256 digests. Files become visible atomically and existing IDs cannot be overwritten. Loading checks ID and digest. The host owns the directory and access controls; these hashes detect accidental content mismatch, not forgery by an attacker able to replace both data and hash. Do not publish private inputs, traces or provider data as part of a public framework release.

This implements reusable dataset execution, outcome gating, baseline comparison and evidence storage. Full release manifests, experiments/canary, production observation/rollback, independent real-model acceptance and human review workflows remain additional work. The deterministic example deliberately catches a broken candidate; it is evidence about the evaluator, not proof that all Core abilities or a real model passed final acceptance.
