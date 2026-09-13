# HTTP capability surface and remote SDK

`createCapabilityHttpHandler({dispatcher, resolveAccess, basePath})` accepts a Web `Request` and returns a `Response`. Mount it in a host supporting the Fetch API; the host owns listening, authentication, request size/time limits and browser origin policy. The default endpoint is `/capabilities`.

- `GET /capabilities` discovers the caller's current contracts, including schemas and whether a stable request key is required.
- `POST /capabilities/<name>` accepts `{input, requestKey?}` and invokes the same dispatcher as internal Agents and MCP. Identity never comes from the request body.
- Function results return HTTP 200 with `{resultKind: 'capability-result', result}`. Agent admission returns HTTP 202 with `{resultKind: 'task-receipt', result}`; its output schema describes the eventual outcome, not this receipt. Expose the existing task capabilities to let callers inspect, resume or cancel admitted work.

The required `resolveAccess(request)` host port returns `{actor, capabilities: ['allowed.name']}` on every request. Discovery is an allowlist, not a substitute for the dispatcher's per-input authorization. The host must authenticate the request before returning this mapping.

```js
import {CapabilityHttpClient} from '@immedi/iaic-core/http/client.js';
const client = new CapabilityHttpClient({
  url: 'https://your-app.example/capabilities',
  headers: async () => ({authorization: `Bearer ${await currentAccessToken()}`})
});
const contracts = await client.list();
const response = await client.invoke('notes.create', {title: 'Next steps'}, {requestKey: 'stable-operation-id'});
```

The SDK has TypeScript declarations; supply your application's contract mapping as its generic parameter. Schemas remain authoritative at runtime. It preserves the distinction between a completed result and an admitted Task, supports AbortSignal and current credentials, and never retries automatically. Stable keys are forwarded, not implemented as a second idempotency store: the domain service or durable Task store owns deduplication. On an unknown result, query/reconcile before deciding to retry; do not generate a replacement key. Aborting a transport does not undo committed effects or cancel an already admitted Task.

## Import an existing JSON API

`importHttpCapabilities({baseUrl,bindings,resolveHeaders,fetch?,timeoutMs?})` creates ordinary deterministic Capability adapters. Import it from the root or `@immedi/iaic-core/http/import.js`. Each explicit host binding provides:

```js
{
  name: 'external.record', description: 'Read an existing record',
  input: inputSchema, output: outputSchema, effect: 'read',
  authorize: actor => canReadRecords(actor),
  method: 'GET',
  request: input => ({path: 'records/' + encodeURIComponent(input.id)}),
  project: body => body.record
}
```

The request mapper receives `(input,{actor,callId,signal})` and returns `{path,query?,body?}`. Paths are relative to the configured base prefix. URL origin/prefix changes and redirects are rejected. Credentials come from `resolveHeaders({actor,callId,signal,capability})` on each execution, outside model arguments. Bodies are JSON; GET does not accept one. The default network timeout is 30 seconds; cancellation/timeout is forwarded to the injected Fetch transport.

Input/output schemas, per-input authorization, optional outcome `verify` and optional context-history `revalidate` are the existing Capability contracts. `project(body,{response,input,actor,callId,signal})` can select high-signal JSON data or inspect response headers. HTTP 204 projects null by default. Non-2xx responses become errors without exposing backend response text. Valid HTTP alone does not prove business completion; use a verifier where a domain result needs evidence. Async remote jobs should expose their admission receipt and separate status/query tools rather than pretending admission is completion.

Writes default to `never-replay`. To declare an idempotent write, specify `retry:'idempotent'` and the remote service's `idempotencyHeader`, which receives the original callId. The remote service must actually enforce this contract; Core does not infer it from HTTP method. There is no automatic retry. Failed or invalid responses after writes remain unknown under the Dispatcher; query/reconcile the existing operation first. Body-based idempotency can be mapped explicitly from context, but this adapter does not automatically certify it as idempotent.

This is explicit JSON API import, not an OpenAPI document parser, automatic endpoint discovery, arbitrary URL browsing or a remote server installer. Host request mappers define usable operations and remote authoritative authorization still applies. `examples/core-http-import` exports an imported API capability through MCP; focused tests additionally exercise a real local HTTP server, credential rotation, stable keys, projection, schema errors and timeouts.
