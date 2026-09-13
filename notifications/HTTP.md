# HTTP notification channel

`createHttpNotificationChannel({baseUrl,resolveHeaders,bindings,idempotencyHeader,fetch?,timeoutMs?})` implements existing notification send/query ports using the shared HTTP importer. It creates no outbox, queue, Runtime or recipient UI. The host binds a provider endpoint, explicit idempotency-header contract, current credentials and recipient resolution. This is a generic JSON HTTP adapter, not a bundled email/SMS/chat vendor integration.

`bindings.send` requires request(input,context) and project(body,context). Optional bindings.query supplies the same functions. Send uses POST; query uses GET. Request returns the existing relative path/query/body mapping constrained to the approved base URL prefix. Redirects reject; current headers and bounded transport timeout follow the common HTTP importer. Mapping function references are captured at construction. The host should select destination and credentials in resolveDelivery(job) under current permission, then return `{allowed:true,...channel}`. Message/source payloads must not select an arbitrary endpoint or credential.

```js
const channel = createHttpNotificationChannel({
  baseUrl: approvedProviderUrl,
  idempotencyHeader: 'Idempotency-Key',
  resolveHeaders: () => currentProviderHeaders(),
  bindings: {
    send: {
      request: input => ({path: 'send', body: {
        recipient: hostResolvedRecipient, message: input.message
      }}),
      project: body => mapProviderReceipt(body)
    },
    query: {
      request: input => ({path: 'receipt', query: {key: input.idempotencyKey}}),
      project: body => mapProviderReceipt(body)
    }
  }
});
```

The exact URL paths and example header are host/provider contracts, not a built-in service API. send({idempotencyKey,message,source,signal}) sends the original outbox ID as the configured header. query({idempotencyKey,signal?}) looks up the same operation. Both project functions must return `{status:'delivered'|'not_sent'|'unknown',idempotencyKey,...}` matching the original request. Terminal results additionally require a nonempty provider evidence reference (at most 500 characters). The host mapper must derive this association from actual provider evidence, not fabricate it by echoing an unrelated request.

The host defines the delivered milestone, such as provider acceptance; it is not proof of human reading. not_sent must prove definitive non-delivery and no outstanding send that could complete later. Ordinary 404/missing results, HTTP success codes, exceptions, aborted requests and elapsed time are not such proof. Non-success HTTP responses throw; during send the existing Notifications service records unknown, while failed reconciliation leaves the original unknown state. Only explicitly mapped terminal evidence changes that state. No automatic send retry or fallback channel is added.

Current resolveDelivery permission is rechecked before send and query, and resolveHeaders is called for each transport operation, supporting key rotation. Omit query when the provider has no safe receipt lookup; unknown deliveries then require another supported adapter rather than being silently replayed. Provider idempotency and definitive-failure semantics must support the outbox's stable-key retry contract. Core cannot manufacture exactly-once external delivery.

Project only bounded, appropriate receipt fields; do not persist credentials or full raw provider responses. Existing outbox history remains under application authorization and retention. This adapter does not implement recipient preferences, unsubscribe rules, templates, inbox UI or provider-specific signing.

Loopback HTTP/PostgreSQL integration proves a lost send acknowledgement is reconciled to the original receipt with one send, verifies current key rotation and revoked query permission, and rejects mismatched/missing receipts. The independently installed core-notifications example uses the adapter with an injected transport. No external messages were sent or provider endpoints registered.
