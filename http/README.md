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
