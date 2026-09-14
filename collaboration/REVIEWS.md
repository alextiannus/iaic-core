# Reciprocal peer-review evidence

`PeerReviews` lets either member review another member's exact work artifact.
`createPeerReviewCapabilities({reviews})` exposes `collaboration.reviews.record`
and `collaboration.reviews.read` through the ordinary dispatcher, SDK, HTTP and
MCP. Add these tools to the built-in Platform Agent and external Agent's permitted
tools explicitly. There is no fixed observer/coder assignment.

Required host ports:

- `resolvePrincipal(actor)` returns the caller's stable, application-qualified
  identity string, never a name selected in model input.
- `readArtifact(actor, {path,revision,digest})` checks current sharing permission,
  reads and verifies the exact content and returns `{reference,author}`. Author
  comes from trusted revision provenance, not the artifact body. The host must
  bind one unambiguous artifact namespace to this service.
- `authorize(actor,{action,review})` checks current team membership and review
  access. Read first checks a metadata-only `{id}` before loading evidence, then
  the complete record. Recording is checked before and after resolving author.
- `store.get(id)` and `store.put(record)` persist immutable review evidence. Put
  atomically binds a globally unique ID within this review service to exactly one
  record and returns it; changed content under that ID conflicts.

`WorkspaceReviewStore({workspace,actor})` supplies this last port over the existing
Workspace module. Give it a dedicated service-owned workspace whose ordinary
write/delete tools are not exposed to team members. It stores each review as
revision 1 at `reviews/<id>.json`; no new table or task engine is introduced.
Alternate stores must preserve the same atomic binding. Artifact sharing and
review-evidence storage may use different authorized workspace scopes.

Record input is `{id,target,verdict,findings,previousReviewId?}`. Target is a full
Workspace-style reference. Verdict is `changes_requested`, `no_findings` or
`inconclusive`; findings are required. Reviewer and author are supplied by the
trusted ports. Self-review is rejected. A follow-up links an existing review of
the same author and logical artifact, at the same or a later revision. Corrections
and rechecks append new records; they do not rewrite the original criticism.
Follow-up links record provenance, not a claim that every earlier finding closed.

Use a stable deliberate review ID and the normal Capability call ID. An identical
review can be retried under the same ID while currently authorized; changing its
findings conflicts. After a lost acknowledgement, read the original review ID.
An absent record does not prove an in-flight write cannot still commit. History
revalidation reads retained evidence and rechecks current artifact access; it
never writes another review. Deleting or withdrawing access to the target prevents
later public review reads, while the service-owned original evidence remains.

These are peer opinions pinned to an artifact version. `no_findings` does not
approve a release, prove correctness or apply to later code. The module does not
run an LLM, transfer task ownership, share credentials or impose two approvals on
every operation. Host Runtime/model configuration and existing Task/operation
receipt collaboration remain responsible for those separate capabilities.

The PostgreSQL integration check exercises both review directions, corrections
and follow-up, reconstruction, changed-ID-content rejection, revoked access and
target deletion. A lost-acknowledgement check recovers the original stored record.
This is mechanism evidence, not yet a live built-in Agent/Codex team demonstration.
