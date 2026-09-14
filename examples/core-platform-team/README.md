# Platform Team host composition

## Start the minimum local host

Use Node 20 and a dedicated PostgreSQL database. Install the supplied Core archive
with `pg@8.23.0` and `@modelcontextprotocol/sdk@1.30.0`. Configure these environment
values in the local MCP client's process environment:

```sh
DATABASE_URL=postgresql://.../your_core_database
IAIC_PROVIDER=chat-completions
IAIC_MODEL=your-system-model
IAIC_MODEL_BASE_URL=https://your-model-gateway.example/v1
IAIC_MODEL_API_KEY=your-system-secret
PLATFORM_GRANT_ID=initial-platform-development
PLATFORM_GRANT_UNITS=1000000
```

Have the client launch:

```sh
node node_modules/@immedi/iaic-core/examples/core-platform-team/stdio.mjs
```

The process uses the existing MCP stdio transport; it opens no public HTTP port.
The launching operator controls its environment and credential access. The local
client is the configured external member, while the native worker uses a distinct
identity. Optional `PLATFORM_APPLICATION_ID`, `PLATFORM_TEAM_ID`,
`PLATFORM_NATIVE_ID` and `PLATFORM_EXTERNAL_ID` identify the host and participants.
This single-client entry is not a multi-user authentication product.

The deliberate grant ID is idempotent across restarts; changing the amount under
the same ID conflicts. A later top-up needs a new deliberate grant ID. Omit both
grant variables to start without funding. The default entry issues platform units
at one unit per metered input/output token, with a 100,000-unit inference hold;
these are allowance rules, not provider pricing. Customize policy through the
factory below. Its minimal verifier checks saved references and a successful work
operation; application-specific semantic correctness remains the injected verifier's
responsibility. The native Runtime permits at most four tool actions in a batch,
using existing ordering, authority and effect-receipt rules.

First create a shared artifact with `my_write_workspace`, then call
`platform.team.request` with a stable requestId and a goal referencing that artifact.
Poll `platform.team.request_result` or `platform.team.task` for the existing Task.
Read and record peer reviews through `collaboration.reviews.read/record`. Supply
the MCP envelope `{input: {...}, requestKey: "stable-operation-key"}` for writes.
The native worker runs in the same server process; restarting preserves stored
work. This is the phase-one local entry, not one of the phase-two Demo Projects.

`openPlatformTeam` in `application.mjs` assembles existing Core modules into a
headless host. It is application-owned composition, not a new Core Agent class or
Runtime. It does not create a User Assistant AI Demo.

The host requires a PostgreSQL pool, application/team identity, trusted built-in
actor, current `authorizeMember` policy, one system profile (`id: 'system'`), secret
resolver, platform-unit policy, independent outcome verifier, source version and
Skill/context root. Omit `modelFactory` to use the real ModelProfiles provider;
`run.mjs` alone injects a deterministic model. Keep credentials in the host secret
resolver. The service does not distribute system credentials or configure an
external member's inference account.

```js
const app = await openPlatformTeam({
  pool, applicationId, teamId, builtinActor, authorizeMember,
  profile: systemProfile, resolveSecret,
  tokenPolicy: platformDevelopmentUnitPolicy,
  verifyOutcome, version: implementationRevision, skillRoot,
  workCapabilities: existingAuthorizedDevelopmentCapabilities
});
// Host-only administrative funding; not exposed as a team tool.
await app.ledger.grant(app.budgetScope, {
  reference: fundingReference, amount: platformUnits, evidence: fundingEvidence
});
app.start();
// Expose app.dispatcher with the existing authenticated HTTP or MCP adapter.
// On shutdown: await app.close(); the host owns pool.end().
```

Both members use shared Workspace and peer-review tools under their own identity.
The shared workspace belongs to the team; revision provenance records its author.
The separate review-evidence workspace has no public direct write/delete tool.
Additional existing function capabilities can be supplied for repository work,
evaluation, execution, original-effect inspection, release or observation. They
retain their original authorization plus current team membership. Default tools
do not perform arbitrary host file edits or production deployments.

`platform.team.request({requestId,goal})` accepts work from either member and
creates a persistent native Task through the original Runtime. Its original
`requestedBy` comes from the authenticated caller, not a model field. Executor and
Agent identity remain the built-in Platform Agent. This is a request for platform
work under native platform authority, not a transfer of the requester's credentials
or a grant inheriting private user authority. Current team membership governs
admission and shared reads; native execution remains governed by native identity
and each tool's current policy. Removing a requester does not itself cancel work
already assigned to the platform; cancellation is a separate host Runtime action.

Retain requestId. It is scoped to application/team/requester and binds the original
goal through Runtime idempotency. Changed input under that ID conflicts; identical
retries recover the same Task. `platform.team.request_result({requestId})` recovers
your original request after a lost acknowledgement. Unknown is not permission to
resubmit with a new ID. `platform.team.task({id})` projects currently authorized
team Task state, requester, executor and result without model transcripts. There
is no new task table, ownership engine or shared login.

Task result sharing revalidates the original tool history under the reading
member's current authorization as well as the native executor's. Team membership
does not inherit private rights from the native executor's injected work tools.

The system model is metered against a fixed platform-development scope, separate
from personal-assistant scopes. The units are issued platform allowance, not raw
provider tokens or currency. An empty platform balance cannot borrow from a
funded personal allowance. Direct external reads, writes and reviews invoke no
hosted model; explicitly requesting native work consumes native platform units.
This host exposes neither user BYOK switching nor public allowance grants.

Every team member must update affected architecture, contracts, operation/recovery
instructions and version migration/lifetime documentation. Peer review and saved
plans are not proof of execution or release acceptance. The injected verifier
must check the application's actual outcomes and evidence.

Run `DATABASE_URL=<isolated PostgreSQL> node examples/core-platform-team/run.mjs`.
The installed example proves shared artifacts and reciprocal reviews, system
profile binding, requester/executor continuity across reconstruction, stable
requests and a separate platform budget: five fixture inferences consume 35
platform units while the funded personal allowance remains unchanged. Both members
can originate requests. No real model, live Codex connection or paid inference is
used in this check. Persistent team-task takeover by the external member and
bidirectional interrupted-work continuation are still unfinished; this host does
not present native-only execution as the final team architecture.

## Real collaboration evidence and limits

On 2026-09-14 the system-model native member and current external Codex completed
a code-review/correction/follow-up loop on this host. Codex then recorded a
reciprocal review of the native-authored assessment through the same PeerReviews
service. STATUS.md records the exact Task and artifact digests, the rejected
incorrect initial findings and a retained unknown inference hold. The deterministic
example remains a separate reproducible check, not a simulation presented as that
real interaction.

For a waiting native Task, a trusted host uses the existing `app.runtime` lifecycle
API to provide input, resume after funding, or cancel work under the native actor.
These administrative controls are not exposed by this minimum stdio entry.
Shared work and review do not reassign a persistent native Task to Codex; arbitrary
interrupted-task takeover is deferred. Integrators explicitly supply authorized
development tools and outcome verification through the factory ports.
