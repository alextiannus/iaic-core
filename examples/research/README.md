# Minimal document-research reference application

This is the reference shape requested in IAiC Note 39: one `research.prepare` Agent Capability, three fixed deterministic operations (`documents.search`, `documents.read`, `reports.save`), one Markdown Skill, and persistent Core Tasks. It supports shared-problem research, comparison and correction of an old report by changing the user goal. No handler branches on the goal or selects the answer for the model.

`application.js` is application code. It owns document access, quoted-source checks and report completion requirements; Core owns capability dispatch, the Agent loop, context and Task history. The host injects identity-aware document permission and the public Workspace interface. This small host uses Core's PostgreSQL Workspace for immutable report storage instead of adding a second local file store. It uses the repository's supported Node 20 runtime; it does not establish the separate Node 24/TypeScript choice in Note 39. These implementation differences are explicit, not claims that every line of that design has been delivered.

The source collection contains two interviews and an old draft. Search returns only documents in the requested scope. Reads check current permission. Reports cite exact quotations from source documents; the old draft cannot support its own claims. A stable save request key selects one artifact path; a repeated request with identical input reuses the saved revision, while changed input is rejected. Task tool calls are restricted to the original document IDs, and history and result verification reread current authorization.

The ordinary verifier checks an artifact exists, preserves the requested scope, and contains exact quotations from accessible sources. **It does not establish semantic correctness.** `cases.json` contains separate content-review requirements, never passed to the model. A content reviewer must judge claims and citations together; matching a quote is insufficient.

## Local integration check

```sh
SUBMISSION_TEST_DATABASE_URL=postgresql://localhost/isolated_database \
node --test examples/research/application.test.mjs
```

This runs actual PostgreSQL checks for source scope, rejected invented quotations, idempotent saved artifacts, changed-input rejection, revocation and persistent Task execution with the loaded Skill. Its small scripted model checks wiring only. It is not dynamic-composition or real-model acceptance.

## Opt-in nine-run real-model evaluation

First freeze and commit the checkout. Confirm any other paid evaluation has a terminal process receipt, no live PID and every planned result row before launching this batch. Never overlap it with the ongoing ImmediToday holdout.

Supply the API key securely through `IAIC_MODEL_API_KEY`, not command arguments. Use a fresh, nonexistent absolute output directory:

```sh
IAIC_RUN_REAL_ACCEPTANCE=1 \
IAIC_ACCEPTANCE_OUTPUT=/absolute/new/evidence-directory \
SUBMISSION_TEST_DATABASE_URL=postgresql://localhost/isolated_database \
IAIC_PROVIDER=chat-completions IAIC_MODEL=your-model \
IAIC_MODEL_BASE_URL=https://your-provider.example/v1 \
node examples/research/run.mjs
```

The runner executes each of the three goals three times with identical code, Skill and source documents. It freezes source SHA, relevant files, model settings and budgets before inference and records every terminal Task, tool history, saved report, elapsed time, cumulative ledger balance and pending reservations. The isolated database schema remains available on both success and failure for inspecting interrupted calls or unresolved usage. Do not clear unknown holds or rerun into the same directory. Platform allowance pricing is synthetic (input 2, cached input 1, output 6 units); it is not provider currency cost. No API key or hidden reasoning is saved.

After all nine results, review each report against its case criteria, including unsuccessful attempts in the denominator. Note 39 requires at least two acceptable results in each class of three. Keep reviewer identity, each decision, required repair and all failures. The runner deliberately leaves `semanticAccepted` null; a successful process or Task does not pass that gate. These developer-authored cases are not an independently curated holdout and do not replace Note 40's 30-run ImmediToday evaluation, human comparison or production acceptance.

No paid model run has been performed for this reference application yet.
