# IAIC-FB-20261005-001A2B implementation task

Scope: the repository feedback's bounded source-provenance, observation-to-issue and original-reporter follow-up contract. This task does not claim the entire historical Obsidian section 12 conversational repair-agent design.

Decision: accepted as reusable Core support composition. Existing Support already supplies identity-scoped report history, trusted deployment/health/regression resolution gates and idempotent Notifications admission. Missing source provenance, bounded trusted observation admission, mandatory recoverable resolution-event composition and independent read evidence are implemented here.

Acceptance:

- Four Host-restored source kinds; agents cannot use the human reporting entrypoint. Trusted immutable source binding, bounded reference projection, explicit candidate status, source-key deduplication and authorization revalidation.
- Original reporter and affected subject are separate. Affected subjects do not gain reads or become recipients automatically. Tenant/reporter isolation and existing immutable issue history remain authoritative.
- Durable committed resolution events require notification admission for user-reported issues via the scheduled Core consumer. A lost admission acknowledgement reuses the same key. Unknown delivery reconciles without resending.
- Read-only follow-up exposes admission, delivery and verified human reading independently, with exact scope/recipient/issue/revision/notification binding. Read evidence is append-once and requires current engineering authority and an authenticated channel resolver.
- Reopened issues keep prior evidence as explicitly historical. Machine-discovered issue notification policy remains Host-owned.
- Additive migration, public types, installed-package reference example, focused and full regression, package and predecessor upgrade checks.

Executable evidence: `test/iaic-support-observations.integration.test.js`, original `test/iaic-support.integration.test.js`, `examples/core-support-follow-up/run.mjs`, and `examples/core-types-consumer/support-follow-up.mts`. Synthetic Host resolvers and delivery/read fixtures use real isolated PostgreSQL; no production data, paid model, customer notification or business write is exercised.

Initial local validation hit sandbox TCP restrictions, then a shared-schema parallel test initialization collision. The new fixture now creates/drops its own PostgreSQL schema; these setup failures were not counted as passing assertions. A subsequent full run exposed a feedback test that froze the real record at submitted with empty implementation references; it now validates the current lifecycle against the existing validator while preserving the original source-evidence assertions.

Application owner next step: adopt the immutable candidate package, initialize the optional receipt table, supply source/read resolvers and current authority, schedule the resolution consumer with a persistent consumer ID, then validate the real application's original-user notification, delivery/read and reopen paths. Core release alone is not application acceptance.

Follow-up Code Review: two reproducible findings (post-storage authorization and failed-admission queue starvation) were fixed; see `REVIEW-001A2B.md`. Resolution consumers now require durable per-consumer retry deferral, and the optional migration contains two additive tables.
