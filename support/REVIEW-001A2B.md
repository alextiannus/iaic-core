# Code Review: IAIC-FB-20261005-001A2B

Reviewed PR #45 implementation at `1bfb58f5b840a11c4e9af36b881e62a80742881f`: source provenance, issue/recipient isolation, async authority restoration, event recovery, notifications, public types and migration. This was a code-and-regression review by the implementing agent, not an independent external review.

## Findings and fixes

1. **P1 — revoked authority could still receive prepared follow-up data.** `SupportFollowUp.recheck` called `SupportIssues.owned`, which authorized before its database read and did not recheck a reporter afterward. Revoking the reporter while the final read was in flight returned the status instead of rejecting. The regression failed with “Missing expected rejection.” Support now restores and compares the current identity after reads, checks ownership/manage access, and revalidates history/list/queue results before returning them. The same final-read scenario now rejects with SUPPORT_ACCESS_DENIED.
2. **P2 — a page of failed admissions could starve later authorized user notifications.** `pendingEvents` always selected the earliest unacknowledged events; failed events never left that first page. With limit 1, a failing notification prevented the second valid report from being admitted across worker restarts. The regression failed with zero acknowledgements instead of one. The resolution consumer now durably defers failed deliveries and orders retries by last attempt, allowing untouched work to advance even if the delay has expired before the next poll. Failure is never acknowledged or discarded. A lost acknowledgement after successful admission still reconciles immediately with the existing stable notification key. Generic consumers retain backward-compatible defaults; enabling resolution consumption requires the new retry port and table.

## Verification contract

Both failures were reproduced before fixes in isolated PostgreSQL. `test/iaic-support-observations.integration.test.js` retains those regressions, including restart/slow-poll fairness, exact identity/source/revision binding, unknown-delivery reconciliation, original-recipient reading, and reopen history. Original Support tests remain intact. Final full module, installed-package, type and predecessor-upgrade results are linked through PR #45 checks before merge/release.

No remaining blocking findings were identified in this scoped review after the fixes. Host authentication, source trust, receiving-channel evidence, scheduler operation and actual application adoption still require Host integration acceptance; fixture tests do not establish production rollout.
