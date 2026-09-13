# Versioned text ingestion

KnowledgeIngestion accepts a trusted source snapshot, splits its text within the Catalog body limit, and atomically replaces that source in PostgresIngestedKnowledgeStore. It is independent of file registrations and single-document PostgresKnowledgeStore; no existing documents are migrated. The ingested store implements the same Catalog list/describe/read/snapshot ports and works with existing Knowledge capabilities, history revalidation and Workspace lineage consumers.

## Source and authorization ports

Construct `KnowledgeIngestion({store,resolveSource,authorize,chunkBytes?,maxSourceBytes?,maxChunks?})`. Initialize the chosen store first. `sync(actor,{sourceId,expectedRevision})` checks current host authorization before resolving the source and again before persisting. The source ID is a registered host reference, not an arbitrary URL to fetch. `resolveSource(actor,{sourceId})` returns a coherent snapshot:

```js
{
  confirmed: true, sourceId: 'manual', sourceRevision: 'upstream-v3',
  reference: 'host-owned-source-reference', mediaType: 'text/markdown',
  title: 'Reference manual', description: 'Approved reference material',
  text: 'The extracted document text', policy: { /* host-defined ACL */ },
  expiresAt: null
}
```

Only text/plain and text/markdown are supplied initially. The host owns authentication, extraction, source access/version verification and policy metadata; model input cannot supply those trusted fields through sync. `confirmed` means the adapter confirms this source snapshot, not that every statement in the document is true. Knowledge remains reference material, distinct from executable Skills, user Memory, working Artifacts and authoritative domain state. No write capability, ingestion UI, crawler or mandatory model call is installed.

## Chunks and persistence

Defaults: source up to 1 MB, chunks up to 16,000 UTF-8 bytes, at most 256 chunks. Configurable maxima are 10 MB per source, 60,000 bytes per chunk and 1,000 chunks. Empty text, NUL and unpaired surrogates are rejected. Splitting preserves all original characters and byte order, never splits a code point, and supplies byteStart/byteEnd (exclusive). It is fixed-size splitting, not semantic chunking or embedding retrieval. Concatenating chunks in part order reconstructs the original source exactly.

Chunk IDs derive from the source ID hash and a zero-based part number; source metadata includes the original ID/reference/revision, text content digest, media type, ingestionRevision, part and byte range. The same source's metadata/ACL/expiry applies to every chunk. Catalog references also hash their current metadata and content. Source text, metadata or chunk-layout changes therefore invalidate prior references.

The PostgreSQL adapter owns two tables: one current source head and its current chunks. One transaction serializes writers for the source, replaces the head/chunks and removes surplus old parts. Each Catalog snapshot joins metadata and content in one statement. This prevents partially committed source replacement; separate read/search requests are not a shared multi-document transaction. Consumers assembling multiple chunks must compare source ID and ingestionRevision and use expectedVersion/history revalidation, rediscovering when the source changes.

First sync uses expectedRevision 0; correction uses the current source revision. Identical snapshots at the current or immediately preceding revision return the original current state without incrementing it, recovering a lost successful sync response. Other stale revisions conflict. Reusing the currently active upstream sourceRevision with different text conflicts; metadata/ACL changes with unchanged text can still create a new ingestion revision. This is a current-snapshot consistency check, not an immutable archive of all upstream revisions.

`state(actor,{sourceId})` returns current source revision/withdrawn state. `withdraw(actor,{sourceId,expectedRevision})` atomically deletes every current chunk and clears head metadata/digest while retaining the source ID and incremented tombstone revision. Restoration requires that exact tombstone revision and a newly resolved authorized snapshot. Raw store mutation ports are trusted ingestion interfaces; they are not public authorization boundaries. A host can implement the same replaceSource/sourceState/withdrawSource and Catalog ports for another database.

## Practical limits

The existing Catalog scans at most 1,000 current entries total, now counting chunks. It does not become a scalable vector index. Literal search operates per chunk and may miss a phrase crossing a chunk boundary. There is no overlap, semantic ranking, automatic PDF/Office/HTML extraction, background sync or source change subscription. Hosts can schedule sync through their own worker or compose future task capabilities using existing scheduling modules.

Withdrawal invalidates current Catalog references and linked lineage checks; it does not erase prior Task/Session/audit copies or independently exported content. No historical body archive is created. The default adapter retains a minimal source ID/revision tombstone; broader retention remains separate work.

Tests cover Unicode preservation, idempotent sync, concurrent correction, transaction rollback after chunk insertion failure, stale references, source/namespace policy, whole-source withdrawal and explicit restoration. The independently installed core-knowledge example imports a document larger than one chunk and uses existing Catalog search/read/withdrawal. This is deterministic storage/lookup evidence, not model answer quality or full Note 30 acceptance.


Catalog-compatible ID validation also applies after replacing a store: a valid legacy ID that is absent from the ingested adapter returns unavailable (404), so current history projection omits its old body instead of interrupting the Agent. This does not migrate or resolve the old source. Integration additionally verifies that withdrawing imported Knowledge removes its body from rebuilt Agent context and invalidates a derived Workspace artifact through existing lineage checks; original audit history remains unchanged.
