# Platform peer-review composition

Run `DATABASE_URL=<isolated PostgreSQL> node examples/core-peer-reviews/run.mjs`
from an installed Core consumer with `pg` and the MCP SDK available.

The existing AgentRuntime records and rereads a review of the external member's
artifact. A separate-principal MCP client then reads that review and reviews the
built-in member's artifact. Both use the same review capabilities and dedicated
Workspace-backed evidence store. The fixture's shared working workspace records
trusted author provenance on each revision.

This is a deterministic integration example, not a real Codex connection, paid
model evaluation, platform-budget demonstration or task takeover. The artifacts
are seeded to isolate the review workflow. Applications configure current team
membership, content sharing, artifact namespace and provenance, system models and
budgets, and expose these capabilities through their existing authenticated entry
points. Never expose direct writes to the reserved review-evidence workspace.

See [the review contract](../../collaboration/REVIEWS.md) for exact references,
immutable findings, follow-up reviews and lost-write acknowledgement recovery.
