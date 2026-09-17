# Model failure and recovery contract

Candidate.98 separates model failures from executor loss. This is Runtime policy,
not a new retry loop or a change to business authority. Applications expose the
Task's `waitingReason`; default task controls/listing also expose `diagnostic`
with an allow-listed `code` and `nextAction`, never provider bodies or reasoning.

| Waiting reason | Code | Action |
| --- | --- | --- |
| model_output_limit | MODEL_OUTPUT_LIMIT | Review the immutable model profile and create a new Task with explicit application effect deduplication and original receipt references |
| invalid_model_action | INVALID_MODEL_ACTION | Review the profile/task after the existing correction budget is exhausted; create a reviewed new Task |
| model_timeout | MODEL_TIMEOUT | Check the original usage before requesting resume |
| provider_error | MODEL_PROVIDER_ERROR | Check provider availability and the original usage before requesting resume |
| usage_reconciliation | USAGE_RECONCILIATION_REQUIRED | Reconcile with trusted provider evidence; never invent zero usage |

A Chat Completions `finish_reason=length`, Responses
`incomplete_details.reason=max_output_tokens`, or Runtime response byte ceiling
produces `model_output_limit`. The first two keep measured usage through the
existing MeteredModel settlement. Missing or unconfirmed usage takes precedence:
MeteredModel still holds it and returns `usage_reconciliation`. A timeout racing
an in-flight gateway can appear as `model_timeout` before gateway accounting
finishes: the diagnostic is **not** evidence that usage settled. A subsequent
metered invocation remains blocked by the original reservation/unknown hold.

The existing bounded correction loop for invalid wire actions remains; once it
exhausts its model-turn allowance the reason is `invalid_model_action` instead
of generic `limit`. Invalid normalized custom-provider actions also stop with
that reason. Task-wide time/turn/tool budgets remain `limit`. Provider failures
outside a Runtime abort use `provider_error`; Runtime's per-model deadline uses
`model_timeout`. Existing bounded 429 behavior remains unchanged.

TaskStore refuses both `resume` and `provide_input` for deterministic
`model_output_limit` and `invalid_model_action` waits with HTTP 409 /
`MODEL_RESTART_REQUIRED`. Direct store callers cannot bypass this check.
Cancellation and reading original receipts remain available. Changing the model
binding alone does not erase the failure. No automatic new Task, business replay
or allowance grant occurs. Applications creating a reviewed successor must carry
forward original business effect identities/receipts; a new Task is not permission
to submit an already committed declaration again.

## Installation and migration

`TaskStore.initialize()` expands the existing waiting-reason constraint. It is
idempotent with the new persisted reasons. Stop old executors and take a normal
backup before upgrading; do not re-run candidate.97 initialization on a database
with the new reasons, since its narrower check constraint cannot accept them.
Returning to .97 requires an application-reviewed migration of affected Tasks;
never relabel outcomes as executor interruptions merely to permit retries.
Existing Tasks retain their original host version; deploy this Core update with
the correct host implementation/version policy.

## Remaining scope

Candidate.98 did not implement deployment handoff. Candidate.99 adds the
host-only drain/generation protocol for feedback §34.1; see EXECUTOR_HANDOFF.md. Historical executor recovery keeps its `interrupted`
reason. Non-model host failures still use the legacy interruption fallback;
separating all host/authorization/configuration failures and renaming historical
executor reasons needs a separate lifecycle/API change. No production incident
was replayed or reconciled by this patch. See billing/RECONCILIATION.md for the
existing trusted evidence API.
