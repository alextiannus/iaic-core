export class CapabilityHttpError extends Error {
  constructor(message, details = {}) { super(message); this.name = 'CapabilityHttpError'; Object.assign(this, details); }
}

// No automatic retry: a lost response cannot prove that a write did not happen.
export class CapabilityHttpClient {
  constructor({url, fetch: transport = globalThis.fetch.bind(globalThis), headers = () => ({})}) {
    this.url = new URL(url);
    if (!['http:', 'https:'].includes(this.url.protocol) || this.url.search || this.url.hash || this.url.username || this.url.password) throw new Error('Use an HTTP capability endpoint without credentials, query or fragment');
    this.url = this.url.href.replace(/\/$/, '');
    if (typeof transport !== 'function' || typeof headers !== 'function') throw new Error('Client requires fetch and a current headers resolver');
    this.fetch = transport; this.headers = headers;
  }
  async list({signal} = {}) { return (await this.request('', {method: 'GET', signal})).capabilities; }
  async invoke(name, input, {requestKey, signal} = {}) {
    if (!/^[a-z][a-z0-9_.-]*$/.test(name)) throw new Error('Invalid capability name');
    return this.request('/' + name, {method: 'POST', body: JSON.stringify({input, ...(requestKey !== undefined ? {requestKey} : {})}), signal}, requestKey);
  }
  // Opt-in business result API. Existing invoke() keeps its transport envelope.
  async invokeResult(name, input, options = {}) {
    const response = await this.invoke(name, input, options);
    if (response.resultKind !== 'capability-result') throw new CapabilityHttpError('Task admission is not a completed capability result; inspect the original operation', {code: 'UNEXPECTED_RESULT_KIND', outcomeUnknown: true, requestKey: options.requestKey});
    return response.result;
  }
  async request(path, options, requestKey) {
    const headers = new Headers(await this.headers());
    headers.set('accept', 'application/json');
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    let response, body;
    try {
      response = await this.fetch(this.url + path, {...options, headers, redirect: 'error'});
      if (response.redirected) throw new Error('Redirected capability response');
      body = await response.json();
    } catch (cause) {
      throw new CapabilityHttpError('Capability response unavailable; reconcile before retrying an operation', {cause, code: 'CAPABILITY_RESPONSE_UNAVAILABLE', statusCode: response?.status, outcomeUnknown: options.method === 'POST', requestKey});
    }
    if (!response.ok) {
      const error = body?.error;
      throw new CapabilityHttpError(error?.message || 'Capability request failed', {...(typeof error?.code==='string'?{code:error.code}:{}),statusCode: response.status, outcomeUnknown: typeof error?.outcomeUnknown === 'boolean' ? error.outcomeUnknown : options.method === 'POST', requestKey, validation: error?.validation, recovery: error?.recovery});
    }
    if (!body || (options.method === 'GET' ? !Array.isArray(body.capabilities) : !Object.hasOwn(body, 'result') || !['task-receipt', 'capability-result'].includes(body.resultKind))) {
      throw new CapabilityHttpError('Invalid capability response', {code: 'INVALID_CAPABILITY_RESPONSE', statusCode: response.status, outcomeUnknown: options.method === 'POST', requestKey});
    }
    return body;
  }
}
