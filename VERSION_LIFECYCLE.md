# Core candidate lifetime and migration policy

Effective 2026-09-14. Platform AI Team members maintain this file when publishing
or retiring a version, together with its release notes and migration evidence.

Core candidates use a **14-day migration window** after replacement. This is the
project's initial policy, not a claim of a user-specified duration or an indefinite
API compatibility promise. Stable releases must declare their own finite support
window before publication. Any extension names the affected version, reason,
owner and new end date; there is no automatic or unlimited extension.

| Versions | Current status | Support ends | Successor / action |
| --- | --- | --- | --- |
| Existing candidates through `v0.1.0-candidate.82` | Superseded; one-time migration window established by this policy | 2026-09-28 23:59 UTC | Migrate to the current verified candidate after checking pinned source, package integrity, module contracts and application evidence |
| `v0.1.0-candidate.83` | Replaced when candidate.84 is published | 2026-09-28 23:59 UTC | Upgrade to candidate.84; Task-bound grants must use Runtime, not direct function invocation |
| `v0.1.0-candidate.84` | Replaced when candidate.85 is published | 2026-09-28 23:59 UTC | Upgrade to candidate.85 for the minimum Platform Team host; existing module contracts unchanged |
| `v0.1.0-candidate.85` | Replaced when candidate.86 is published | 2026-09-28 23:59 UTC | Use the successor for MCP clarification and continuation; old Tasks retain their original host version binding |
| `v0.1.0-candidate.86` | Replaced when candidate.87 is published | 2026-09-28 23:59 UTC | Continue old Tasks on their pinned host; successor adds native private resources and installed Skills |
| `v0.1.0-candidate.87` | Replaced when candidate.88 is published | 2026-09-28 23:59 UTC | Successor adds optional peer tables/APIs; existing Task and Delegation semantics stay pinned |
| `v0.1.0-candidate.88` | Replaced when candidate.89 is published | 2026-09-28 23:59 UTC | Upgrade for peer recovery fixes; no schema migration, preserve existing request keys and receipts |
| `v0.1.0-candidate.89` | Peer recovery fixes prepared by this source; current upon verified publication | On replacement, record an explicit date 14 days later | Existing peer tables and grants remain valid; current host read/operation policy still governs receipt reconciliation |

The GitHub release and verified asset determine whether publication occurred.
A source commit or this preparation record alone is not a published version.

End of support means no ongoing feature work or compatibility promise for the old
candidate. It does **not** remotely stop an installed application, delete archived
packages/evidence, expire database rows or cancel tasks. Hosts own deployment and
execution eligibility. Any runtime retirement must use the existing release/task
controls and retain original operation receipts, including unresolved effects.

For each replacement, the publishing member records the exact source and artifact,
affected contracts/concepts, required migrations, old version's final support date,
verification results and known limitations. The reviewing member checks both code
and these documents. Use the current concept as the source of truth; name breaking
changes and give migration instructions instead of accumulating aliases or fallback
semantics that change the meaning of Core abstractions.

Before retiring a deployed version: inventory its consumers and pending work,
verify the successor, migrate compatible state explicitly, and reconcile unfinished
or unknown operations under their original identity and version. Do not replay
effects to make a migration appear complete. An old version may need restricted
receipt inspection after retirement; that is retained evidence access, not general
continued execution or indefinite compatibility support.

ImmediToday was last verified on candidate.81. Its migration is **not verified by
this document** and remains required work before the above support deadline. No
production configuration or runtime is changed by adopting this policy.
