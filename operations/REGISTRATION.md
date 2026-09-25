# Agent inventory, presence and feedback

Core owns reusable contracts and persistence, not an application's list of Agents
or operator grants. OperationsRegistry is a trusted in-process Host port: do not
expose its database methods as unauthenticated tools or generic HTTP endpoints.
A namespace is a storage boundary, not authorization. The existing Operations
service still checks current observer authorization, scope and per-Agent visibility.

Register descriptors referencing the original AgentIdentityStore identity (or an
explicit external authority). Registration does not create an execution identity,
grant permissions, activate a model, start a Task or prove health. Principal,
workspace and source identity cannot be reassigned by updating the same record.
Use lifecycle paused/retired for historical visibility. All registrations survive
process restarts; bounded workspace-filtered keyset pages support a complete roster.

AgentIdentityStore.page/find provide trusted inventory metadata without memory,
Workspace content or conversations. TaskStore.agentSummary and readAgentTaskSources
provide bounded owner-and-instance-filtered status, model request evidence and
principal-to-Agent request edges. Active work sorts first. More than 50 Tasks is
explicitly incomplete; it is not a total workload count. Task inputs/results and
call arguments are never projected. A model_requested event is not provider
attestation of the actual model. No fabricated peer review or delegation is inferred.

Executors are separate from Agents. startExecutor fences the prior generation;
heartbeat accepts increasing sequence numbers only, with database receipt time and
a bounded 1–60 second lifetime. Retrying an accepted sequence returns conflict,
not a new lifetime. Use a unique executor ID for independent workers; a stable ID
means an intentionally single reporting authority. These are observation leases,
not Task ownership leases. The Host chooses the basis: trusted local readiness is
observed; external self-reports must be reported. Presence alone is never complete
model/connector health. Expired evidence remains inspectable and cannot certify health.
The caller must include all required probes and honestly declare source completeness.

The optional dashboard accepts refreshMs (2–60 seconds; default 30 seconds).
This is near-real-time bounded polling, not an event stream or zero-latency promise.
Authorization is rechecked on every read. The Host owns collector scheduling,
external credentials and transport. Core installs no background process.

Optional feedback list/report ports plus authorizeMutation enable a small feedback
form. Each submission has a stable request key for response-loss retries. The Host
must validate Origin and a CSRF defence, current operator access, the Agent boundary,
and idempotence. Compose SupportIssues to retain acknowledgement and verified
resolution; do not build another issue authority or interpret a report as an
authorization to repair, deploy, spend, or mutate Tasks. Without these ports the
dashboard remains read-only. The default UI shows the bounded feedback list supplied
by the Host; a full ticket console remains application-owned.
