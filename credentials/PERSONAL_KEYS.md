# Personal API keys

`PersonalApiKeys` is an optional headless credential module for external User Assistants.
It authenticates an existing account in one explicit organization (or personal context).
It does not create accounts, infer organization membership, provide a login UI or issue
model-provider credentials. Import `credentials/personal-keys.js` and
`credentials/personal-key-store.js`; both have public TypeScript declarations.

Compose with `AccountDirectory` and a matching `PostgresPersonalKeyStore` namespace.
Call store.initialize() once to add the independent iaic_personal_keys table. Existing
accounts, Tasks and model keys are unchanged. A replacement store must preserve namespace
isolation, immutable owner/scope/terms, account-wide request-key uniqueness and atomic
rotation. Raw store methods are trusted Host ports, not public endpoints.

The Host supplies authorizeManagement({actor,current,action}) and
resolveCapabilities({actor,current}). Management requires an independently authenticated
owner session; deny if that session is absent. Personal-key actors are also explicitly
denied management by the module. Never accept a serialized Actor from client/model JSON.
The Host chooses eligibility, maximum key lifetime, consent and management route security.

- issue(actor,{label,capabilities,expiresAt,requestKey}) returns {credential,token}.
  The token contains a random UUID and 256 random secret bits. Only SHA-256 is persisted.
  The raw token is returned once, never by list. No key is auto-created on login.
- list(actor,{after?,limit?}) returns owner metadata across organizations, at most 100
  records per page. IDs are pagination cursors, not chronological event offsets.
- revoke(actor,id) is permanent/idempotent, including keys for a former organization;
  the owner can manage them from an active personal context. Records are retained.
- rotate(actor,id,input) atomically revokes the old key and inserts the replacement.
  New terms require explicit current owner authorization and may differ. Concurrent
  replacement has one winner. Failed insertion rolls back revocation.
- authenticate(token) returns {actor,capabilities}, binding the stored owner and
  organization. Capabilities are the intersection with the current Host capability
  policy; account/organization suspension, removed membership, expiry and revocation
  deny subsequent checked access. No credential secret is copied to the Actor.
- check(actor,capability) rechecks key and current account/organization access at actual
  execution. Preserve personalCredentialId in trusted durable Actor codecs and wire this
  check into Runtime authorization as well as the capability/domain authorization path.
  A cached discovery result is not execution authority. Check domain/resource rules too.

For HTTP resolveAccess, strictly parse the Authorization: Bearer header and return
keys.authenticate(token). For MCP, validate the token before initialization in Host
middleware, and use the same authenticated mapping in resolveAccess on every list/call.
Use the model surface for external assistants. The helper is not an OAuth server and
must not treat unsigned client authInfo as verified context. TLS, rate limiting, CORS,
CSRF on browser management routes and secure client secret storage belong to the Host.
Keep raw tokens out of prompts, task history, logs and memory.

Issuance uses an explicit stable request key. Repeating a committed request returns 409,
not another token. If the response was lost, list/reconcile and revoke the inaccessible
credential, then deliberately issue a new one with a new request key. Never silently
retry under a different key. Rotation has the same unknown-response rule: the old token
may already be revoked. This module does not store recoverable plaintext secrets.

Credential scope never grants account permission or a Mandate. Autonomous tasks still
need their own authorization and domain constraints. Checks are not a transaction with
an external business effect; already admitted/in-flight work may finish after revocation.
Hosts that need to stop future durable execution must wire check into every execution
path. Do not strip the credential reference or fall back to a more privileged Actor.

No production credentials are issued by installing this module. Upgrade opts into the
new table and routes; rollback disables those routes/writers and preserves records,
without admitting credential-bound Tasks on a Host that ignores their binding.
See test/iaic-personal-keys.integration.test.js for PostgreSQL, rotation races and HTTP.
