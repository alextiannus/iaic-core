# Workspace source lineage

WorkspaceLineage supplies optional exact-source dependency validation and a bounded traversal of derived Workspace sources. Memory, Knowledge and Workspace retain their own stores and owners. References are saved atomically in the existing Workspace version's source.lineage metadata; there is no new content archive or global fact table.

Construct it with `capture({actor,input,source,context})` and the current source readers needed by the application:

- `readMemory(actor,{key,revision})` returns the current exact-key Memory read. It must be active at the captured revision; disputed, expired and forgotten statements are unavailable.
- `readKnowledge(actor,{id,version})` returns the current authorized Knowledge read, normally `knowledge.read(actor,{id,expectedVersion:version})`.
- `readWorkspace(actor,{path,revision,digest})` returns the current head through an authorized raw Workspace store read. Lineage recursively validates its source metadata itself; do not recursively call the lineage-enabled service in this port.

Every reader must enforce the current actor's scope and source policy. References do not grant access or choose a tenant. This initial adapter resolves dependencies in that actor's configured source domain; cross-owner provenance requires a separately authorized reader adapter.

Capture returns at most 20 `{kind:'memory'|'knowledge'|'workspace', reference}` entries with the exact shapes above. The required host capture port chooses the sources of a derivation; it must account for the inputs actually used. A model's declaration alone is not proof of complete lineage. Runtime now supplies its Task ID as trusted execution context through Dispatcher, Assistant tool composition and Workspace.write; capture can use the owner-scoped Task history to identify source references. This Task ID is correlation, never an authority grant. SDK writes may supply host context explicitly. Automatic semantic source extraction, implicit Memory/Session injections and arbitrary copied text are not inferred by this module.

Supply the instance as `new AssistantWorkspace({store,resolveScope,sourceFor,lineage})`. Existing services that omit lineage retain their existing contracts. Writes validate captured sources before saving; they cannot use the output path as their own source. Use distinct paths for derivation stages, or have the trusted capture policy explicitly track the actual underlying sources when editing. Metadata must still fit the Workspace store's ordinary 4 KB source limit.

Read validates every dependency before returning the derived body, including explicitly requested old output revisions. List filters source-invalid heads while preserving the underlying pagination cursor; an empty page with a cursor still requires following it. Memory correction/forgetting/dispute/expiry, Knowledge correction/withdrawal/denial, and Workspace source-head changes or deletion invalidate the derived result. A Workspace version remaining physically stored does not mean it is still a current source. Existing Assistant result revalidation converts these 404 SOURCE_INVALIDATED errors to unavailable history, so cached working content cannot be returned through that path.

Lineage is conservative read-time validation, not a distributed atomic snapshot. A source can change after a check. Traversal defaults to 100 nodes and depth 10. Missing readers, untracked legacy artifacts, malformed references, cycles and graph limits fail closed as unresolved rather than treating data as independent. Enabling lineage for existing data requires an explicit migration/capture policy; it does not silently certify old content.

## Explicit derived-content cleanup

`workspace.purgeInvalid(actor,{after?,limit?})` scans one bounded page of current heads. It requires the trusted `authorizePurge({actor,artifact,error})` port on WorkspaceLineage to permit each deletion. Source denial and source removal can look identical to a reader; host policy must decide whether physical erasure is appropriate. Mere permission loss must not be turned into broader unauthorized deletion.

Only SOURCE_INVALIDATED results are eligible. Missing configuration, legacy untracked content, provider/database errors and uncertain traversal never authorize cleanup. Accepted removals use the original head revision and the existing Workspace remove transaction, which erases all versions of that document and retains its tombstone. A concurrent correction wins over an older purge scan. The response contains content-free removal receipts and nextCursor; pages are not one global transaction. Keep the normal Workspace mutation authorization at any public API boundary. No automatic destructive tool or cleanup scheduler is installed.

This does not globally erase raw Task audit, Session/user input, exported/downloaded copies, unrelated domain records, or stale historical versions of a document whose current head is valid. Those retention scopes and propagation policies remain incomplete. The original memory or knowledge store remains authoritative for its own deletion. A valid source does not prove that an Agent interpreted it correctly; the application's outcome verifier remains necessary.

Validation: four PostgreSQL integration checks cover transitive forgetting, Knowledge correction/withdrawal, revision-safe purge and the actual Runtime context path. The independent core-lineage example uses real source and artifact stores, reconstruction, unavailable references and physical removal of derived bodies. These are lifecycle/control evidence, not real-model reasoning-quality results.
