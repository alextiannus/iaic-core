# Independent-principal collaboration

Optional, headless `iaic.peer.v1` communication between independently authorized
principals. This is separate from delegated execution and Platform Team shared work.
An application Business AI or deterministic controller governs business channels;
Platform AI maintains this module. A ChannelGrant never transfers domain authority.
Application-owned connectors run under the System Owner mandate; principal-owned
connectors run under that principal's Role/Mandate/resource/credential authorization.
Hosting a channel never grants Platform AI or Business AI the provider's connector
credentials. Provider-specific mappings stay in its adapter.

## Compose only the services needed

Root exports: `PostgresPeerStore`, `PeerCollaboration`, `PeerInformationRequests`,
`PeerHumanTasks`, `PeerFormalActions`, `PeerDeliveryRecovery`, `createPeerCapabilities`.
See [the runnable composition](../../examples/core-peer-collaboration/fixture.mjs)
for complete constructor arguments and initialization. The store initializes new
`iaic_peer_records` / `iaic_peer_audit` tables and the existing notification tables.
Use a dedicated namespace, then register the selected capabilities with the existing
CapabilityDispatcher. Installing the package alone starts no service or worker.

Required trusted host ports for PeerCollaboration:

| Port | Host responsibility |
| --- | --- |
| resolveIdentity / restoreActor | Current authenticated tenant, principal, Agent, role binding and mandate; restore authority for queued work |
| authorize | Explicit action policy, controller authority, participant access, current mandate and disclosure; never trust envelope claims |
| verifyEndpoint | Independently prove endpoint reference/protocol and identity; return verificationRef and validUntil. An Agent Card alone is not proof |
| validateContent | Validate approved message types and schema versions, including structured information answers |
| readEvidence | Resolve current authorized source content, version, subject/version, producerRef, issuedAt, validUntil and revocation; apply sender AND recipient disclosure policy |
| resolveDelivery | Trusted original endpoint adapter with send and preferably query; no domain writes in this communication adapter |

Core checks reference SHA-256, source version, expiry and provenance fields; the host
proves source authority and ACLs. AuthorityRef is represented through this source
port, not a separate credential issuer. Credentials, Memory and Workspace remain
private unless explicitly disclosed through an approved reference/content policy.

## Contracts and state

Exact versioned JSON schemas and operation names live in [contracts.js](contracts.js).
Public Capability names prepend `peer.`. Never supply sender identity in content as
a replacement for current authenticated authority.

1. A controller verifies immutable endpoints, creates a requested channel and issues
   independent send/receive grants. Activation requires an explicit transition.
2. Channels have a subject/version, fixed expiry, human owner, message/attempt limits
   and allowed formal capabilities. Configuration changes compare `expectedRevision`.
   Active channels may suspend or close; closing/closed/expired cannot reopen.
   Revoked endpoint bindings cannot reactivate. A new grant supersedes the old one.
3. Message acceptance compares `expectedSequence` and subject version, increments one
   channel sequence, and atomically stores the envelope, request-key index and outbox.
   The same sender/channel/requestKey and identical input return one logical receipt;
   changed input is a conflict. No global order across channels is claimed.
4. Durable inbox reads include only addressed/sent messages and recheck current source
   access. `message.lookup` recovers an original metadata receipt after a lost response,
   even after closure/revocation if current read policy permits it.
5. Receipt milestones are accepted, queued, unknown, sent, delivered, application
   acknowledged or failed. Adapters must explicitly return a sent/delivered milestone
   and receiptRef. Only the bound recipient can acknowledge. None proves domain success.

Inputs are capped at 64 KiB canonical JSON; resolved evidence at 8 MiB; default
admission rate is 60 messages per channel per minute. Channel limits are explicit.
`retainBody:false` admits references only. Stored content must already be minimized
by the host; there is no automatic redactor, TTL purge or legal retention policy.
Namespace-level PostgreSQL serialization makes the first implementation simple;
this is not a high-throughput benchmark. Host callbacks must be bounded and must not
reenter this namespace's transactions. Authentication/schema failures before module
execution need host ingress auditing; stored operation audit is not a complete SIEM.

## Delivery and recovery

The existing Notifications outbox owns attempts and delivery leases. Schedule
`peer.tick()` or `recovery.tick()` from the host. Before send, current channel,
subject, endpoint, pinned grants, sender authority and evidence are checked again.
Revocation blocks new admission; it cannot undo an already admitted external effect.

Timeout or worker death is Unknown. Query the original adapter idempotency key;
never blindly resend. `delivery.reconcile` can retain/query original receipts after
closure under read policy. Explicit `delivery.retry` requires definitive not_sent,
current send authority and remaining attempts. The host schedules retry backoff and
ticks; Core does not supply a second scheduler. Query adapters must inspect the
original effect, not infer absence from a missing response.

Optional PeerDeliveryRecovery creates one durable HumanTask per problematic delivery
through a host escalation policy (stable requestKey and dueAt). Unknown or exhausted
failures qualify. Humans have an owner, claim, allowed resolutions, evidence and
expiry/cancellation. Resolving a task does not execute a domain command. Subsequent
attempts after resolution do not automatically reopen that task; the host owns that
follow-up policy. Pending tasks remain inspectable when new peer work is disabled.

Information requests target one endpoint, specify only required fields and accept
answered/refused/unavailable responses. Answers cannot add unrequested fields.
This initial implementation supports inline request bodies and derived expiry;
explicit request cancellation and reference-only structured requests remain future work.

## Formal actions and rollback

Only separately composed PeerFormalActions receives the existing domain dispatcher.
`formal.submit` explicitly associates source messages/current subject version with
an allowed capability, validates authority, and persists an intent before invocation.
The domain capability must provide revalidation and outcome verification. It must
honor the stable callId/effect key or expose original-effect query; Core cannot make
an arbitrary remote service exactly-once. `formal.lookup`, result and reconcile retain
original results; Unknown is not resubmitted. Receipt/result access still requires
current submitting identity and domain capability authorization.

Set peer `isEnabled` false to block new channel/grant/message/send admissions; set
formal `isEnabled` false to block new submissions. Closing channels and revoking grants
remain available. Keep receipt queries, original adapters and database state during
rollback; never delete pending intents or replay them under another identity.
The upgrade adds tables/APIs without changing Delegation or existing business facts.

## Evidence and limits

[The example](../../examples/core-peer-collaboration/README.md) uses real loopback HTTP,
in-process MCP and official A2A mappings. PostgreSQL integration tests cover isolated
identities, grants/revocation, dedup/order, evidence, structured input, human escalation,
formal unknown recovery and an actual killed delivery worker. Models and real 12Eat
transactions are not invoked. This is a minimum implemented candidate, not completion
of Note47 P0, production endpoint verification, every failure boundary or full A2A
conformance. The consuming application must supply its identity, source, transport,
domain, retention and operating policies and validate its own integration.
