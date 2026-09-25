# Own-model credentials

`UserModels({pool,encryptionKey,endpoints,factory?})` owns the `iaic_user_models` table and its encrypted credentials. `initialize()` creates that table. The host supplies a dedicated base64-encoded 32-byte encryption key, an approved endpoint catalog and trusted `{applicationId,subjectId}` scope. Model selection per Assistant/job remains in AssistantSettings/AssistantModels; a different assistantId alone does not create another credential owner.

Public methods:

- `endpoints()` returns host-approved endpoint metadata.
- `save(scope,{label,model,endpointId,apiKey})` makes a small connection-validation request, then stores an AES-256-GCM encrypted key and returns metadata. This is connectivity evidence, not a model-quality evaluation.
- `list(scope)` returns available metadata without raw credentials.
- `resolve(scope,id,{expectedIdentity?})` returns a provider port with `credentialMode:'BYOK'`; it re-reads current availability/revocation before each call and binds identity to the endpoint revision.
- `revoke(scope,id)` marks the record revoked and clears its stored encrypted secret.

The host controls which HTTPS endpoints may be used, obtains user authorization for saving/testing a credential and authenticates calls to this module. Provider redirects are disabled. Raw keys are not returned in list/resolve metadata. Missing/revoked credentials fail rather than falling back to a platform-paid key.

AssistantModels composes this port with settings and the allowance ledger. BYOK calls use zero platform allowance charge; provider use remains separately recorded. The host owns key management, configuration UI and credential-owner mapping. This module supplies no password manager, OAuth flow, global backup erasure or automatic encryption-key rotation.

## Application access credentials

Personal application API keys are separate from the provider credentials above.
See [PERSONAL_KEYS.md](PERSONAL_KEYS.md) for user/organization-bound issuance,
expiry, revocation, atomic rotation and authenticated HTTP/MCP composition.
