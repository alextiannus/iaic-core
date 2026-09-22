# Support issue lifecycle (additive Basic module)

SupportIssues connects user reports to engineering work and verified resolution. It does not implement an autonomous code writer, new scheduler, business recovery or deployment engine. Reuse Tasks for engineering work, Observation/ReleaseManager for trusted runtime evidence and Notifications for transport. This source change is unreleased until packaged, independently verified and published.

Host ports restore current identity and authorization on each call. `scopeId` is an application-defined tenant boundary; `subjectId` is the authenticated reporter. Reports only contain bounded summary and optional task/request/release/error references. User text and references are untrusted; they are not instructions to Platform AI or proof of an incident. The host handles consent, redaction, attachment policies, source verification, retention, rate limits and automatic error ingestion. No caller-supplied actor, notification destination or verdict is trusted.

`report` is idempotent by namespace/scope/reporter/requestKey. Same-key different-content submissions fail. Different reporters keep separate issues even if symptoms match; cross-user deduplication and privacy-safe subscriptions are future work. `list` shows the current reporter's issues; `queue` requires manage permission. `get` checks reporter ownership or current manage permission. Hosts must deny manage access by default.

States: received → triaged → fixing → verifying → resolved → closed. Verification may return to fixing; resolved/closed can reopen, then return to triage. Reporter may close or reopen only their issue. Engineering changes require manage permission. Each change has an expected revision, atomic history, and conflict rejection; after lost acknowledgement read the issue/history instead of blindly applying again.

Resolution accepts an evidence ID, never a caller verdict. Trusted `resolveResolution` must verify current deployed release, health and regression, and bind confirmed:true, scopeId, issueId and expected revision. It returns deployed:true, healthy:true, regressionPassed:true, releaseId and verificationId. The service rechecks current authorization after resolution and stores only immutable references. A host must implement this check from trusted deployment/evaluation systems, not relay JSON from the model or end user. Source revocation/retention remains host policy.

`notify` queues an existing immutable event to the original reporter through Core Notifications, using `support:issueId:revision`. Replays reuse that event identity; no notification is sent by state mutation itself. A worker can recover after interruption by enumerating issue events and enqueueing them with this stable key. The host configures an authorized notification actor and logical `support` channel, maps to the user's original inbox/channel, schedules notification ticks and verifies delivery receipts. Queueing is not delivery, delivery is not human reading, and unknown delivery is reconciled rather than blindly retried. Historical messages carry their original revision and must not be shown as the current status after reopen.

Initialize the additive PostgreSQL schema through the host's migration lifecycle. `createSupportCapabilities` provides report/get/list/queue/update/notify via the normal dispatcher with input schemas and read-history authority revalidation. No table in the existing task, notification or observation modules is changed.

Remaining scope: host capture/UI, trusted Platform Agent identity, engineering-task linking/claiming, automatic event collection, cross-reporter deduplication, notification scheduling, deployed release adapter and actual user acceptance. This module does not claim these are configured in 12Eat.

`list` and `queue` return bounded pages (default 50, maximum 100). Pass the last issue's `id` as `afterId` until an empty/short page; ordering is stable by UUID, not creation time. Restart a scan to discover concurrent reports inserted before the cursor. Tenant/reporter authorization applies independently to every page. Notification admission rechecks the caller after the asynchronous sender resolver.

`SupportEventConsumer` is a trusted host worker port for durable engineering handoff
and notification admission. Each independent consumer acknowledges individual events
only after its delivery port succeeds. A failed callback remains pending, including
when its external effect succeeded but the acknowledgement was lost. Delivery ports
must use the supplied stable `requestKey` to deduplicate or query that effect before
retrying. This is not a task executor and grants no code, repository, or deployment
authority. Do not expose `pendingEvents` directly to untrusted callers. The host must
restore current engineering authority and scope before exposing any report content.
