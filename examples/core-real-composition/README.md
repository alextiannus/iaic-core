# Opt-in actual-model composition acceptance

This example runs three frozen synthetic operational tasks through the same public AgentRuntime, current Skill discovery/read, Memory, Workspace, model provider, platform allowance ledger and EvaluationRunner. No goal-specific capability performs filtering or arithmetic for the model. A read Capability supplies current raw records; a reusable Skill explains selection rules; the model chooses calls and writes an artifact. The external grader receives expected results and compares the actual stored JSON plus trace requirements. Expected answers are not passed to the model or runtime verifier.

The tasks cover regional readiness, held-record exceptions and correction of a stale artifact. They were authored with this harness and are disclosed in dataset.json: they are a small novel-composition sample, not an independently curated blind held-out benchmark. Do not tune these cases and claim untouched holdout evidence. The runtime verifier checks artifact completion; the stricter external grader is the authority for this evaluation's outcome. Both a terminal Task and correct persisted content are required to pass.

This is deliberately excluded from verify-examples and ordinary CI: it sends paid requests only with explicit opt-in. Supply a local isolated PostgreSQL URL, model provider/endpoint, credentials and a new private output directory through the environment:

```sh
IAIC_RUN_REAL_ACCEPTANCE=1 \
IAIC_ACCEPTANCE_OUTPUT=/absolute/new/private/evidence-directory \
IAIC_SOURCE_REVISION=your-committed-revision \
SUBMISSION_TEST_DATABASE_URL=postgresql://localhost/isolated_database \
IAIC_MODEL=your-model IAIC_PROVIDER=chat-completions \
IAIC_MODEL_BASE_URL=https://your-provider.example/v1 \
node examples/core-real-composition/run.mjs
```

Set IAIC_MODEL_API_KEY securely outside command arguments. The script refuses missing opt-in and nonlocal databases; each case creates and drops only its random schema. Sources, model selection, Skill, dataset and execution bounds are recorded before inference. Each case has at most 10 turns, 8 tool calls and a five-minute task deadline. Issued units and pricing are synthetic platform allowance policy, not supplier currency charges. Credentials and hidden reasoning are not written to evidence.

The originating Runtime is closed after Task admission and rebuilt before execution. This demonstrates reconstructed-task continuity, not process-kill recovery. Persisted evidence includes failed/waiting cases, actual tool receipts, usage events, artifact readbacks, immutable complete evaluation and gate result. Do not erase failures or silently rerun into the same directory. A fresh re-evaluation needs a fresh directory; any fixes invalidate prior claims about an untouched dataset. The script exits nonzero on failed gates.

Passing this sample alone does not satisfy Note 30: independent held-out coverage, different persistent Agent responsibilities, cross-surface equivalence, autonomous collaboration and production evolution remain separate acceptance work.

## Preserved first actual-model result

At source 87cafa4b6d607b3e51e587257360a7ec0d649677, DeepSeek V4 Flash completed 30 provider responses across three cases; none passed, all stopped at the turn limit. Eighteen responses proposed multiple calls and were rejected by the existing single-action contract. The fixture also omitted Memory listing, leaving the model to guess the preference key. Actual usage was 69,655 input plus 8,338 output Tokens; synthetic platform units were 77,993 under the explicitly 1:1 fixture policy, not a currency bill. All usage reservations settled. These failures are retained in the private practice evidence, not classified as successful Core acceptance.

The current harness supplies Memory listing. Grader v2 recognizes the requested preference whether read by exact key or observed through the list result, since both expose the same source content. This corrects the fixture scope and grading assumption; it is a changed evaluation configuration and has not yet passed an actual-model run. Future results must remain separate from v1. The multiple-call incompatibility remains a Core model/Runtime capability gap; the harness does not drop calls, silently execute batches, or relax outcome checks to hide it.
