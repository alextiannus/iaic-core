# Capability access diagnostics

candidate.106 adds public denial codes without changing authorization or granting
access. Host authentication, Actor resolution and business entitlements stay with
the application. Reuse one current `{actor, capabilities}` projection behind the
HTTP and MCP resolvers; each list/call resolves again. A previous catalog is never
authority for a later call. Domain authorization still runs in the Dispatcher.

| Code | Meaning |
| --- | --- |
| CAPABILITY_NOT_AVAILABLE | Name is absent from the current Host projection, or unknown. These cases intentionally have the same public response. |
| CAPABILITY_ACCESS_DENIED | A listed capability's Domain authorize hook returned a value other than true. |
| CAPABILITY_SCOPE_DENIED | Direct Dispatcher invocation exceeded its trusted allowedCapabilities scope. |
| ACTOR_REQUIRED | Dispatcher identity validation failed. This does not authenticate a transport credential. |
| CAPABILITY_SURFACE_DENIED | Existing model/host consumption boundary rejected an otherwise projected capability. |

HTTP exposes `error.code` and retains its status (404 unavailable, 403 denied,
401 invalid Actor). MCP keeps missing tools as JSON-RPC InvalidParams with
`error.data.code` and `error.data.statusCode`; Dispatcher denial is still a tool
result with `isError: true` and JSON `error.code` in text content. Do not turn an
unknown business write into a new request key based on any generic failure.

No response enumerates hidden names or explains private entitlement rules.
Unavailable does NOT mean the Host projection is accidentally wrong. Only Host
fixtures with explicit expected catalogs can diagnose omissions. The Framework
must never probe write execution or expand access to infer that intention.

Only deliberately public bounded `publicCode` values cross these protocol
boundaries. MCP no longer forwards arbitrary `error.code` values or lets them
overwrite the public classification. Hosts should not put private data in public
codes or client-facing 4xx messages. This is not a general log redaction system.

Migration: consume codes where present and retain the existing HTTP/MCP envelopes.
No database or Task migration. Preserve Task identity, operation keys and receipts.
Rollback to 105 removes the new codes and restores the old private-code behavior;
remove dependence on new codes and maintain equivalent redaction in the Host.
The Actor fixture matrix helper, automatic projection consistency checks and full
OAuth error taxonomy are separate pending work, not part of this delivery.
