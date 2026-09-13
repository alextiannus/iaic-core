# Actual-model persistent Agent continuity

This opt-in evaluation uses the public Agent application template, not a separate Runtime. A persistent configured job owns scoped Memory, Knowledge, Skills and Workspace. The originating application admits a Task linked to a Session, closes that Session, and stops its Runtime. A separate worker process then loads the original Agent identity/model and executes the Task. The parent reopens the application to inspect the saved JSON, original Task and current result projection in the closed Session.

The authored synthetic goal combines project identity from the Session, a presentation preference from Memory, raw source records from Knowledge and an installed summary Skill. The external grader checks exact persisted content and resource/continuity evidence. The expected result is kept in the parent evidence and is not passed to the worker. A fresh random project identifier prevents a fixed answer from satisfying the Session check; this is still an authored sample, not independent blind holdout coverage.

Set `IAIC_RUN_REAL_ACCEPTANCE=1`, a fresh `IAIC_ACCEPTANCE_OUTPUT`, the committed `IAIC_SOURCE_REVISION`, local isolated `SUBMISSION_TEST_DATABASE_URL`, and `IAIC_MODEL`, `IAIC_PROVIDER`, `IAIC_MODEL_BASE_URL`, `IAIC_MODEL_API_KEY`. Run `node examples/core-real-continuity/run.mjs`. Credentials remain in the environment. Ordinary CI does not run this paid evaluation.

Before inference, frozen.json records source, model, Skill digest, data and execution limits: 12 model turns, 12 tool calls, batches at most four, 60-second model deadline and five-minute Task deadline. Platform units are a synthetic allowance policy and remain distinct from provider Tokens/currency. Failed or waiting outcomes and trace evidence are preserved; no automatic re-run or provider fallback is performed. result.json includes independent checks and fullCoreAcceptance:false.

For an explicit no-provider preflight, also set `IAIC_CONTINUITY_FIXTURE=1` and use fixture model/credential values. That mode imports a deterministic fixture provider and marks result.json realModel:false; it is never selected after a real provider failure. Do not count fixture usage as actual model consumption.

This checks actual-model queued work after Session closure and worker process separation, not SIGKILL during inference, recurring scheduling, autonomous delegation or all Note 30 acceptance criteria. Only synthetic local schemas are created/dropped. Production services and private business data are not used.

The first actual run at 8382009 failed: the configured tools omitted Memory listing, the model guessed keys, wrote ascending IDs and stopped at its tool bound. The template and evaluation now expose the existing Memory listing capability; the grader checks the exact preference through either authorized read or list. Expected artifact contents and execution bounds are unchanged. The original six-response failure is retained separately; this correction changes the evaluation configuration and is not a blind holdout claim.

## Clarification and original input receipt scenario

Set `IAIC_CONTINUITY_CLARIFY=1` with the existing opt-in variables to run a second, explicitly authored scenario. The initial goal withholds exclusion and ordering choices and asks the Agent to obtain clarification before writing. The frozen data adds a fourth record. After the first worker waits for input, the host submits an explicit exclusion and ascending-order override, injects a lost application acknowledgement, reconstructs the application, queries the original receipt and repeats the same request. A second worker continues the same Task/model/identity after the Session is closed.

The parent freezes the expected artifact before inference and adds checks for an actual input wait, no premature artifact, one clarification and an identical original receipt. Existing checks still require Skill, Memory, Knowledge, artifact readback, Session result linkage and settled usage. The model must use the latest clarification rather than the contrary stored presentation preference. This fixture is synthetic, authored and not an independent held-out evaluation. The result identifies actual versus explicit fixture mode; a provider failure never falls back to the fixture. `before-clarification.json` preserves the initial Task and trace separately, even if the Agent does not ask as expected.

Set `IAIC_CONTINUITY_MEMORY_UPDATE=1` for the separate authored lasting-preference
scenario; do not combine it with CLARIFY mode. The user explicitly asks to update
existing `style` memory once to ascending identifier order, then apply it with
Skills, Knowledge and the closed Session project reference to the verified
artifact. The tool scope adds only the existing memory remember Capability.
The frozen grader additionally requires the exact new preference at revision 2
and one successful remember operation; default mode remains unchanged.

This new scenario preselects Runtime's standard 20-turn/30-call limits with a
four-call batch ceiling. Those limits are frozen before its first actual run and
are not a change to previous failed scenarios. The 12/12 budgets of older modes
remain unchanged. This is an authored capability-composition case, not an
independent holdout or a claim that all real-model acceptance conditions pass.

## Planning and once-only memory configuration

Add `IAIC_CONTINUITY_PLANNING=1` to MEMORY_UPDATE mode to enable the public Task
Plan module and a host-defined one-attempt ceiling for the explicitly once-only
memory mutation. The goal also requests a brief persistent working plan. The
grader adds a nonempty saved-plan check, without treating step statuses as proof
of completion; all prior artifact, source, once-only memory, continuity and usage
checks remain. Memory/plan snapshots are retained with the original trace.

This is an explicit configuration/scenario variant, frozen as
`continuity-memory-plan-v1`, not an untouched re-test or independent holdout.
Budgets stay at the memory scenario's 20 turns / 30 calls, batch ceiling four,
60-second inference deadline and five-minute Task deadline. No general Workspace
write ceiling, automatic plan, fixed execution sequence or paid fallback is added.
An unsuccessful actual run is retained without increasing its budgets. The
deterministic preflight exercises the same installed module configuration.
