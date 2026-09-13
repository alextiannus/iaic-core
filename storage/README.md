# Object storage

`FileObjectStore({directory,maxBytes?})` is a default filesystem object adapter for binary or text bytes. `put(scope,Uint8Array)` returns `{sha256,byteLength}`; get verifies size and content digest, and remove removes the scoped object. Scopes have separate hashed directory prefixes. Repeated identical content is deduplicated in that scope; an existing corrupted object is rejected rather than silently replaced. Writes become visible atomically and do not overwrite an existing object path.

`ObjectStorage({store,resolveScope,authorize})` wraps default or replacement put/get/remove ports with current host authorization and implicit scope. Callers do not select another owner's storage scope by supplying a reference. The default store limit is 32 MiB per object; policy and aggregate storage quotas remain host or future service concerns. A replacement backend can use cloud object storage while preserving content verification and scope semantics.

`createObjectCapabilities({storage,prefix?,maxTransferBytes?})` exposes put/get/remove through the shared Dispatcher. Default Capability transfer is 1 MiB using canonical base64; raw SDK ports accept bytes within the backend limit. Read results can be revalidated in model history. Blob storage does not supply Workspace logical paths, revision histories, memory, metadata search or shared ACLs; existing Workspace/Knowledge services retain those responsibilities and can compose a blob backend.

Object references identify bytes, not permissions or business truth. Deletion makes the object unavailable in this scope; a later explicitly authorized put of identical bytes can recreate it. This differs from Workspace's logical-path tombstones. Retention policies, shared reference counts, media metadata, signed URLs, S3-specific adapters and deletion of already downloaded copies are not supplied here.

The filesystem root is trusted server-owned storage, not an untrusted process workspace or sandbox. Applications manage filesystem access and lifecycle. No files are executed and no browser content type is inferred from bytes. See `examples/core-objects` and the release resource loader for independent composition.
