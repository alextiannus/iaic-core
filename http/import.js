import {defineCapability} from '../capabilities/index.js';
const fail = (message, statusCode = 400, details = {}) => Object.assign(new Error(message), {statusCode, ...details});

// Explicit host bindings import existing JSON APIs without another business loop.
export function importHttpCapabilities({baseUrl, bindings, resolveHeaders, fetch: transport = globalThis.fetch, timeoutMs = 30000}) {
  const base = new URL(baseUrl);
  if (!['http:','https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw fail('HTTP import requires a credential-free base URL');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  if (!Array.isArray(bindings) || typeof resolveHeaders !== 'function' || typeof transport !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw fail('HTTP import requires bindings, current headers, transport and a bounded timeout');
  const names = new Set();
  return bindings.map(binding => {
    const {name, description, input, output, effect, request, idempotencyHeader, project = body => body, verify, revalidate} = binding;
    const method = binding.method ?? 'GET', retry = binding.retry ?? (effect === 'write' ? 'never-replay' : undefined);
    if (names.has(name)) throw fail('Duplicate imported HTTP capability');
    names.add(name);
    if (!['GET','POST','PUT','PATCH','DELETE'].includes(method) || typeof request !== 'function' || typeof project !== 'function') throw fail('HTTP binding requires a method, request mapper and optional result projection');
    if (idempotencyHeader !== undefined) {
      if (typeof idempotencyHeader !== 'string' || !idempotencyHeader) throw fail('Idempotency header must be a name');
      new Headers({[idempotencyHeader]: 'validate'});
    }
    if (effect === 'write' && retry === 'idempotent' && !idempotencyHeader) throw fail('Idempotent HTTP writes require an explicit remote idempotency header contract');
    return defineCapability({name, description, input, output, effect, authorize: binding.authorize,
      ...(retry ? {retry} : {}), ...(verify ? {verify} : {}), ...(revalidate ? {revalidate} : {}),
      implementation: {kind: 'function', execute: async (value, context) => {
        const mapped = await request(value, context);
        if (!mapped || typeof mapped.path !== 'string' || mapped.path.startsWith('/') || Object.keys(mapped).some(k => !['path','query','body'].includes(k))) throw fail('HTTP request mapper must return a relative path and optional query/body');
        const url = new URL(mapped.path, base);
        if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.username || url.password || url.hash) throw fail('HTTP request escaped its configured service prefix');
        if (mapped.query !== undefined) url.search = new URLSearchParams(mapped.query).toString();
        const headers = new Headers(await resolveHeaders({...context, capability: name}));
        headers.set('accept', 'application/json');
        if (idempotencyHeader && context.callId) headers.set(idempotencyHeader, context.callId);
        const options = {method, headers, redirect: 'error'};
        if (mapped.body !== undefined) {
          if (method === 'GET') throw fail('GET binding cannot send a body');
          options.body = JSON.stringify(mapped.body);
          if (options.body === undefined) throw fail('HTTP request body must be JSON');
          headers.set('content-type', 'application/json');
        }
        if (context.signal?.aborted) throw fail('Execution cancelled', 409);
        const timeout = AbortSignal.timeout(timeoutMs);
        options.signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;
        let response, body;
        try {
          response = await transport(url, options);
          if (!response.ok) {
            throw fail(response.status < 500 ? 'Remote API rejected the request' : 'Remote API is unavailable', response.status >= 400 && response.status < 500 ? response.status : 502, {remoteStatus: response.status});
          }
          body = response.status === 204 ? null : await response.json();
        } catch (error) {
          if (error.remoteStatus) throw error;
          throw fail('Remote API response unavailable; reconcile writes before retrying', 502);
        }
        return project(body, {response, input: value, ...context});
      }}});
  });
}
