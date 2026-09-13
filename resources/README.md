# Personal and organization resource scopes

DirectoryResourceScopes composes a current account-directory port with the existing Memory/Workspace stores. It supplies scope selection and resource authorization; it neither copies private data into an organization nor introduces another storage engine, Agent Runtime or UI.

```js
const scopes = new DirectoryResourceScopes({
  applicationId: 'my-application',
  directory, // AccountDirectory, or an equivalent authenticated current(actor) port
  authorize: ({current, owner, access, operation, resourceId}) =>
    owner === 'personal' || access === 'read' ||
    current.membership.roles.includes('editor')
});
const resolveScope = scopes.resolver({owner: 'organization', resourceId: 'team-assistant'});
const memory = new AssistantMemory({store: memoryStore, resolveScope, sourceFor});
const workspace = new AssistantWorkspace({store: workspaceStore, resolveScope, sourceFor});
```

The example policy is a host choice, not a built-in editor role or a grant to every organization member. Supply an explicit policy for sensitive operations such as forget, import, assessment or purge. The application selects owner (`personal` or `organization`) and resourceId in trusted composition. Model arguments cannot replace the fixed resolver target. Both human and Agent accounts may be members; they use the same current checks.

Memory and Workspace now pass `{access:'read'|'write', operation}` as the second resolveScope argument for every operation. Existing one-argument resolvers remain compatible. Direct service use and Capability history revalidation therefore check the same current membership and operation policy. Assessment additionally retains its separate assessor policy. A resource may be exposed through existing Task/HTTP/MCP Capability composition without adding a separate resource-sharing UI.

The default directory's current(actor) verifies authenticated actor binding and re-reads active account, organization and membership. A replacement current port must provide equivalent checks and current `{account, organization, membership}` records: account/organization have id/state, membership has accountId/organizationId/state and policy-relevant roles. The scope module checks active state and membership binding, but cannot authenticate an untrusted actor if the injected port does not do so. No account store import is required.

Stable typed owner keys separate personal and organization partitions, even if external IDs coincide. SHA256 encodings keep scope fields bounded and avoid reusing existing legacy private partitions. Resource IDs and application labels are bounded to 200 characters; directory principal IDs may be up to 500. Both members of one organization resolve to the same resource partition, so revision updates, corrections, forgetting and deletion use the original stored objects. Personal resources remain account-specific across active organization contexts. An actor invalidated by membership removal must be reauthenticated in a permitted context before accessing any resources.

This is a new opt-in partition convention. Existing private data is not moved or automatically shared; sourceFor should retain the actual authenticated author, since shared ownership is not authorship. Raw resource stores remain trusted internal ports. Existing source invalidation and lineage rules still apply, but this does not erase previously exported content, change shared Task ownership or create a general ACL schema. Membership checks do not make later resource writes atomic with revocation; authoritative storage/adapters retain their concurrency obligations.

The integration test uses actual PostgreSQL directory, Memory and Workspace defaults. It verifies current read/write roles, shared original revisions, organization and personal isolation, correction/forgetting propagation, and revocation. Additional systems can replace the directory current port without changing resource modules.
