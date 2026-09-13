# Signed event ingress

`HmacEventIngress` supplies a default authenticated event input. It writes to the existing EventStore; existing EventTriggers and DeferredTasks can react to the resulting immutable key. It does not run a model, create another queue or interpret payload claims as authoritative domain facts. This is the IAiC event envelope profile, not a claim of compatibility with GitHub, Stripe or other vendor signature formats.

## Host contract

Construct with `{store,resolveEndpoint,now?,maxAgeMs?,maxFutureMs?,maxBodyBytes?}`. The current `resolveEndpoint({endpointId,keyId})` returns `{enabled:true,scope,secret}` only for an approved endpoint/key, where secret is a Buffer of at least 32 bytes and scope is the trusted EventStore owner scope. Disabled, unknown or retired keys must return null/disabled. Secret lookup and owner selection are host code; the request cannot choose an owner. Do not log or expose the returned secret. Source attribution records endpoint ID, the first accepted key ID and signed timestamp, not the signature or secret.

`accept({endpointId,keyId,deliveryId,timestamp,signature,body})` accepts original body Buffer bytes. Endpoint IDs allow 1–32 ASCII letters/digits/dot/underscore/hyphen, key IDs 1–64, and delivery IDs 1–128. Timestamp is a decimal integer string in Unix milliseconds; signature is `sha256=` followed by 64 lowercase hexadecimal characters. Defaults: maximum body 8,000 bytes, maximum age five minutes, maximum future clock skew 30 seconds. Body must be valid UTF-8 JSON with an object root. Bytes are copied before asynchronous credential lookup.

Signature input is the UTF-8 header below followed immediately by the exact body bytes (including original spaces/newlines):

```text
iaic-event-v1
<endpointId>
<keyId>
<deliveryId>
<timestamp>
<raw-body-bytes>
```

Each of the five header lines ends with one LF byte; then append the original body bytes without adding a newline. `eventSigningBytes(envelope)` constructs the same sequence for a sender. Sign with `createHmac('sha256',secret).update(eventSigningBytes(envelope)).digest('hex')` and add the `sha256=` prefix. Constant-time comparison and freshness checks precede JSON publication. Both endpoint and delivery identity are covered by the signature. This is an authenticity check for the signal, not a general Permission or Mandate grant.

## Replay, source attribution and trigger keys

The immutable key is `iaic-webhook:<endpointId>:<deliveryId>`. An unchanged delivery returns its original Event ID/digest/source; changed data conflicts. A sender retry outside the freshness window must sign a new timestamp while retaining its original delivery ID and data. Key rotation also retains the original event and first source attribution. Disabling a signing key rejects later requests, including duplicate requests; it does not retract already accepted events or cancel existing Tasks.

All ordinary publishers sharing this event scope must configure `AssistantEvents({...,reservedPrefixes:[WEBHOOK_EVENT_PREFIX]})`, where the exported prefix is `iaic-webhook:`. Direct EventStore access is trusted internal code. Ingress additionally rejects a receipt whose original source kind/endpoint differs, preserving the existing source instead of upgrading it. Reserving the namespace before enabling ingress is required to prevent ordinary publishers from creating a matching trigger key first; source conflict detection does not retract a pre-existing event.

Register an existing EventTriggers follow-up on the exact key. Before publication it waits without inference; matching saves original event ID/digest/time and the existing DeferredTasks creates the follow-up using its stable Task key. Trigger publication is not proof the payload is true. The Agent should read the authoritative domain capability when taking business action, with current Task/Mandate/tool authorization. This profile provides exact-key one-time subscriptions, not wildcard streams, ordering, expiry or retention.

## Optional Node HTTP handler

`createHmacEventHandler({ingress,endpointId})` is a Node HTTP request handler for one fixed host-selected endpoint. It accepts POST, uncompressed `application/json`, and headers `x-iaic-key-id`, `x-iaic-delivery-id`, `x-iaic-timestamp`, `x-iaic-signature`. Duplicate signature headers are rejected. Successful responses expose only ID/key/digest/publication time, not source data or credential material. Invalid signature/freshness returns 401, conflicting delivery/source 409, oversized bodies 413. Internal failures return a generic 500.

The hosting server supplies HTTPS, request/header deadlines and deployment-level admission limits. This handler can be mounted behind an existing router; it does not start a public server or automatically register a vendor webhook. Vendor-specific verification should use a separate adapter and the same event publication contract.

PostgreSQL and loopback HTTP tests cover retry, original provenance through key rotation, malformed/untrusted inputs, current source disablement, bounded HTTP bodies and one deferred Task after a trusted signal. The independently installed core-events example consumes the new ingress. No external vendor or production webhook has been registered or exercised.
