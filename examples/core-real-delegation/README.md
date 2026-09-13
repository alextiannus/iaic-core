# Opt-in actual-model delegation evidence

This authored same-owner collaboration scenario uses the public TaskHandoffs,
AgentRegistry, Runtime, Skills, Workspace and metered provider modules. A coordinator
is asked to delegate a readiness artifact to a specialist, receive its result and
independently read back the artifact. Raw records and a reusable selection method
are available; no Tool implements the goal-specific calculation. The host verifier
checks saved JSON against independently computed expected values. The external
grader additionally requires one child, distinct persistent identities, child
source/Skill/readback evidence, parent readback without writing, exact references,
no owner resume, current scope, durable child model admissions and settled billing.

The harness freezes inputs, Skill digest, model configuration, expected values and
bounds before inference. Expected values are not put in model messages. It rebuilds
the Runtime once a delegation is persisted; this is orderly Runtime reconstruction,
not a worker SIGKILL or remote Agent claim. The common resource scope is an explicit
same-owner fixture choice. Cross-principal grants, cancellation and failed-child
takeover have separate deterministic/process-interruption evidence; this scenario
does not retest or certify them through an actual model.

Run a no-cost preflight with IAIC_DELEGATION_FIXTURE=1. For paid inference, use
IAIC_RUN_REAL_ACCEPTANCE=1 and provide IAIC_MODEL_API_KEY securely through the
environment, plus IAIC_MODEL, IAIC_PROVIDER and IAIC_MODEL_BASE_URL. Both modes
require IAIC_SOURCE_REVISION, a fresh IAIC_ACCEPTANCE_OUTPUT directory and an
isolated local SUBMISSION_TEST_DATABASE_URL. Run `node examples/core-real-delegation/run.mjs`
from a source checkout or copy this example into an independently installed Core
consumer. It is intentionally excluded from default examples/CI paid execution.

There are at most ten model turns and ten tool attempts per Task, ten model
admissions for the single child, a batch ceiling of four, a 60-second inference
limit and a five-minute deadline per Task/child grant. There is no automatic retry
of a failed evaluation. A fixture ledger issues two million platform units with
explicit 1:1 accounting, unrelated to provider pricing or real user balances.
Unknown usage remains pending; snapshot evidence is retained before the random
schema is removed. Credential values are never included in evidence.

A result must pass all 16 checks. The deterministic fixture uses expected values
only to test the evaluation plumbing; its pass is not actual-model evidence.
This is not a third-party blind holdout, a statistical quality estimate, full
protocol conformance or completion of all Note 30 criteria. Preserve unsuccessful
runs rather than tuning the grader and presenting the old scenario as untouched.

## First actual-model result

The first DeepSeek V4 Flash run at f37c9ec302039aaabfa1dbdf820ffdb6371d8302 passed
all 16 checks: parent f5a03e7a-0011-4ba3-b2cc-69c49b5b5573 and child
802690e9-6781-46d4-ab30-e942d1473c39 both succeeded. Nine model requests, eight
Tool attempts, four child model admissions and one artifact write produced the
correct A/D selection and total 12. The parent read it back after automatic
resumption. Usage was 25,420 input plus 4,364 output Tokens, with no unknown usage
or remaining reservations. Deterministic preflight and actual-model evidence are
stored separately; no paid retry or grader adjustment was performed.
