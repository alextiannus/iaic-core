# Release selection from actual Agent evidence

This opt-in consumer loads preserved actual-model baseline/candidate evaluations
from two distinct suites, binds them to immutable release resources and exercises
the existing PostgreSQL release workflow. It makes no provider calls and is not
part of the default suite because it requires externally obtained model evidence.

Supply IAIC_RELEASE_EVIDENCE_PLAN (JSON file), IAIC_RELEASE_EVIDENCE_OUTPUT (fresh
private directory) and an isolated local SUBMISSION_TEST_DATABASE_URL. The plan is:

```json
{
  "baseline": {"capability": "/evaluation/directory", "regression": "/other/evaluation/directory", "archive": "/verified/core.tgz", "integrity": "sha512-..."},
  "candidate": {"capability": "/candidate/capability", "regression": "/candidate/regression", "archive": "/verified/candidate-core.tgz", "integrity": "sha512-..."}
}
```

Directories are outputs from core-real-composition. The supplied archives and
frozen evaluation configuration must come from the host's verified source/build
chain. Digest checks prove consistent bytes, not the truth of an arbitrary host's
claim about what it evaluated. The example compares suite configuration/revisions,
verifies immutable EvaluationStore snapshots and requires all seven original checks.
Both candidate suites compare against their own retained baseline under unchanged
dataset, grader, environment and repeat pins. Model provider labels do not claim
immutable remote weights.

It registers baseline/candidate records, rejects mismatched revision evidence and
an explicitly injected candidate startup failure, resolves a canary, loads checked
archive/config/prompt bytes, binds the persistent Agent identity, then performs an
authorized rollback drill. Reconstructed services recover the original rollback
receipt and baseline resources; the stopped candidate binding/resource reads fail.
The injected failed candidate never calls a model and is not presented as a real
model regression. The rollback drill does not fabricate production telemetry.

The two actual suites remain small authored samples, not a statistical rollout
policy. No post-release inference, cloud deployment, business side effects or
production observation is performed here. Existing Runtime release-stop tests and
observation/Docker examples provide separate execution and monitoring evidence.
Retain this distinction when reporting the combined evidence chain.
