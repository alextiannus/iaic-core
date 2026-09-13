// Fetch API adapter. The host owns listening, authentication and request limits.
const failure = (message, statusCode) => Object.assign(new Error(message), {statusCode});
const json = (body, status = 200) => Response.json(body, {status, headers: {'cache-control': 'no-store'}});
const needsKey = cap => cap.effect === 'write' || cap.implementation.kind === 'agent';

export function createCapabilityHttpHandler({dispatcher, resolveAccess, basePath = '/capabilities'}) {
  if (!dispatcher?.capabilities || typeof dispatcher.invoke !== 'function' || typeof resolveAccess !== 'function') {
    throw new Error('HTTP requires a dispatcher and current access resolver');
  }
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(basePath)) throw new Error('Invalid HTTP basePath');
  return async request => {
    let cap, requestKey, started = false;
    try {
      const path = new URL(request.url).pathname;
      const listing = path === basePath;
      const name = path.startsWith(basePath + '/') ? path.slice(basePath.length + 1) : null;
      if (!listing && (!name || !/^[a-z][a-z0-9_.-]*$/.test(name))) throw failure('Route not found', 404);
      if (request.method !== (listing ? 'GET' : 'POST')) return new Response(null, {status: 405, headers: {allow: listing ? 'GET' : 'POST'}});
      const access = await resolveAccess(request);
      if (!access?.actor || !Array.isArray(access.capabilities) || access.capabilities.some(n => typeof n !== 'string') || new Set(access.capabilities).size !== access.capabilities.length) throw failure('Access denied', 403);
      const capabilities = access.capabilities.map(n => {
        const value = dispatcher.capabilities.get(n);
        if (!value) throw failure('Host capability configuration is invalid', 500);
        return value;
      });
      if (listing) return json({capabilities: capabilities.map(c => ({
        name: c.name, description: c.description, input: c.input, output: c.output,
        effect: c.effect, retry: c.retry ?? null, requestKeyRequired: needsKey(c),
        resultKind: c.implementation.kind === 'agent' ? 'task-receipt' : 'capability-result'
      }))});
      cap = capabilities.find(c => c.name === name);
      if (!cap) throw failure('Capability not available', 404);
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw failure('JSON content type required', 415);
      let body;
      try { body = await request.json(); } catch { throw failure('Invalid JSON body', 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(body, 'input') || Object.keys(body).some(k => !['input', 'requestKey'].includes(k))) throw failure('Body requires input and optionally requestKey only', 400);
      requestKey = body.requestKey;
      if (requestKey !== undefined && (typeof requestKey !== 'string' || !requestKey.trim() || requestKey.length > 200)) throw failure('Invalid stable request key', 400);
      if (needsKey(cap) && requestKey === undefined) throw failure('A stable requestKey is required', 400);
      started = true;
      const result = await dispatcher.invoke(name, body.input, {actor: access.actor, callId: requestKey ?? null, signal: request.signal, allowedCapabilities: access.capabilities});
      return json({result, resultKind: cap.implementation.kind === 'agent' ? 'task-receipt' : 'capability-result'}, cap.implementation.kind === 'agent' ? 202 : 200);
    } catch (error) {
      const statusCode = Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : 500;
      const outcomeUnknown = error.outcomeUnknown === true || (started && statusCode >= 500 && (cap?.effect === 'write' || cap?.implementation.kind === 'agent'));
      return json({error: {
        message: statusCode < 500 ? String(error.message).slice(0, 2000) : 'Capability execution failed', statusCode, outcomeUnknown,
        ...(typeof requestKey === 'string' ? {requestKey} : {}),
        ...(Array.isArray(error.validation) ? {validation: error.validation.slice(0, 20).map(({instancePath, keyword, message}) => ({path: instancePath, keyword, message}))} : {}),
        ...(outcomeUnknown ? {recovery: 'Query or reconcile the existing operation before retrying. Retain the same request key.'} : {})
      }}, statusCode);
    }
  };
}
