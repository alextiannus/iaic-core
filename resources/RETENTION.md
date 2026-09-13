# Bounded expiry cleanup

RetentionSweep composes independently owned stores. Existing read-time expiry prevents use of expired Memory/Knowledge. This optional cleanup also clears expired payload from their current database rows, keeping version tombstones. Enabling expiry cleanup is an explicit host retention decision: an expired memory could previously be edited at its current revision; after cleanup, restoring content requires the existing explicit relearn/sourced restore flow. No old content is recovered.

`new RetentionSweep({resolveStore,authorize}).run(actor,{sourceId,limit=100})` requires current host authorization before lookup and before every erasure. The host maps sourceId to a fixed authorized resource partition, never to arbitrary caller-controlled database scopes. Memory needs a bound adapter:

```js
const boundMemory = {
  expired: options => memoryStore.expired(trustedScope, options),
  expire: reference => memoryStore.expire(trustedScope, reference),
};
```

PostgresKnowledgeStore and PostgresIngestedKnowledgeStore directly supply the same expired/expire port in their configured namespace. Stores are trusted internal ports; raw methods do not authenticate actors. The host authorizer must explicitly permit retention cleanup for the selected partition, including shared organization data. Current authorization cannot undo an in-flight operation.

expired returns up to 100 `{id,revision}` references without content/source. expire rechecks current version and expiration using PostgreSQL statement time at mutation. There is no caller-supplied cutoff, scope expansion or arbitrary age deletion. A concurrent correction, extension or completed cleanup yields a 409 and is reported as changed. Other failures stop the batch and attach content-free retentionProgress with only confirmed receipts. An unacknowledged commit is not claimed as erased: inspect original state or run a fresh selection, never assume an error means no deletion occurred. One sweep is not an all-stores transaction or stable historical receipt. `batchFull` means the limit was reached, not proof of more work or total completion.

Memory clears content/source/dispute/assessment, increments revision and sets its ordinary forgotten tombstone. Current kind/key/expiry/timestamps remain. Document Knowledge clears metadata/content and increments its withdrawn tombstone. Ingested Knowledge uses the existing source advisory lock and one transaction to clear head metadata/digest and delete all chunks; it retains sourceId/revision/withdrawn. This serializes against ingestion updates, and any chunk deletion failure rolls back the entire expiry operation. Concurrent sweeps cannot erase a replacement revision.

Existing Knowledge/Memory history revalidation and WorkspaceLineage can detect expired/withdrawn sources; this service does not automatically sweep derived artifacts. Database UPDATE/DELETE is logical current-row erasure, not forensic erasure of WAL, backups or storage media. Task audit, Session text, exports, import receipts, application data and external copies retain their separate policies. No full-account deletion, legal-hold policy, default retention duration, background scheduler or global-erasure guarantee is introduced. The host can schedule bounded sweeps with its existing worker; do not expose a batch as an idempotent Capability, since later invocations may cover different newly expired records.

Integration tests cover current authorization/revocation, partitions, concurrent sweeps, concurrent expiry extension and transactional chunk deletion failure. The installed three-store example requires isolated PostgreSQL, creates/drops a random schema, and contacts no model or external service. See examples/core-retention/run.mjs.
