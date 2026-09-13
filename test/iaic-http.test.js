import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {defineCapability, CapabilityDispatcher, createCapabilityHttpHandler, CapabilityHttpClient} from '@immedi/iaic-core';

const schema = {type: 'string'};
const actor = {subjectId: 'user', scopeId: 'organization:user'};
const define = (name, effect, execute, extra = {}) => defineCapability({name, description: name, input: schema, output: schema, effect, ...(effect === 'write' ? {retry: 'idempotent'} : {}), authorize: a => a.subjectId === 'user', implementation: {kind: 'function', execute}, ...extra});
const clientFor = (handler, headers = () => ({authorization: 'Bearer current'})) => new CapabilityHttpClient({url: 'https://example.test/capabilities', headers, fetch: (url, init) => handler(new Request(url, init))});

test('HTTP SDK uses the dispatcher contracts, current access and stable domain keys', async () => {
  let writes = 0, access = {actor, capabilities: ['note.read', 'note.write']}, credentials = 'Bearer current';
  const stored = new Map();
  const dispatcher = new CapabilityDispatcher({capabilities: [define('note.read', 'read', input => input), define('note.write', 'write', (input, {callId}) => {
    if (!stored.has(callId)) { stored.set(callId, input); writes++; }
    return stored.get(callId);
  })]});
  const handler = createCapabilityHttpHandler({dispatcher, resolveAccess: request => {assert.equal(request.headers.get('authorization'), credentials); return access;}});
  const client = clientFor(handler, () => ({authorization: credentials}));
  const catalog = await client.list();
  assert.deepEqual(catalog[0].input, schema);
  assert.equal(catalog[1].requestKeyRequired, true);
  assert.deepEqual(await client.invoke('note.read', 'hello'), {resultKind: 'capability-result', result: await dispatcher.invoke('note.read', 'hello', {actor})});
  await assert.rejects(client.invoke('note.write', 'hello'), {statusCode: 400, outcomeUnknown: false});
  await assert.rejects(client.invoke('note.write', 42, {requestKey: 'bad-input'}), error => error.statusCode === 400 && error.validation.length > 0);
  await client.invoke('note.write', 'saved', {requestKey: 'same'});
  await client.invoke('note.write', 'saved', {requestKey: 'same'});
  assert.equal(writes, 1);
  access = {actor: {...actor, subjectId: 'revoked'}, capabilities: ['note.read']};
  credentials = 'Bearer renewed';
  await assert.rejects(client.invoke('note.read', 'secret'), {statusCode: 403});
  access = {actor, capabilities: []};
  assert.deepEqual(await client.list(), []);
  await assert.rejects(client.invoke('note.write', 'saved', {requestKey: 'same'}), {statusCode: 404});
  assert.equal(writes, 1);
});

test('HTTP distinguishes durable admission, uncertain writes and lost responses without replay', async () => {
  let writes = 0, admissions = 0;
  const cap = define('note.write', 'write', () => { writes++; throw new Error('private backend secret'); });
  const agent = define('note.assist', 'read', null, {implementation: {kind: 'agent', instructions: 'Work', tools: ['note.write'], verify: () => true}});
  const dispatcher = new CapabilityDispatcher({capabilities: [cap, agent], tasks: {create: ({idempotencyKey}) => {admissions++; return {id: 'task', status: 'queued', requestKey: idempotencyKey};}}});
  const handler = createCapabilityHttpHandler({dispatcher, resolveAccess: () => ({actor, capabilities: ['note.write', 'note.assist']})});
  const client = clientFor(handler);
  await assert.rejects(client.invoke('note.assist', 'goal'), {statusCode: 400});
  assert.equal(admissions, 0);
  const receipt = await client.invoke('note.assist', 'goal', {requestKey: 'job'});
  assert.equal(receipt.resultKind, 'task-receipt');
  assert.equal(receipt.result.requestKey, 'job');
  assert.equal(admissions, 1);
  await assert.rejects(client.invoke('note.write', 'new', {requestKey: 'write'}), error => error.outcomeUnknown && error.requestKey === 'write' && !error.message.includes('secret'));
  assert.equal(writes, 1);
  const disconnected = new CapabilityHttpClient({url: 'https://example.test/capabilities', fetch: async (url, init) => {await handler(new Request(url, init)); throw new Error('Connection lost');}});
  await assert.rejects(disconnected.invoke('note.assist', 'goal', {requestKey: 'lost'}), {outcomeUnknown: true, requestKey: 'lost'});
  assert.equal(admissions, 2);
});

test('HTTP envelopes cannot supply identity and cancelled requests do not start execution', async () => {
  let calls = 0;
  const dispatcher = new CapabilityDispatcher({capabilities: [define('note.read', 'read', i => {calls++; return i;})]});
  const handler = createCapabilityHttpHandler({dispatcher, resolveAccess: () => ({actor, capabilities: ['note.read']})});
  const response = await handler(new Request('https://example.test/capabilities/note.read', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({input: 'x', actor: {subjectId: 'admin'}})}));
  assert.equal(response.status, 400);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(clientFor(handler).invoke('note.read', 'x', {signal: controller.signal}), {statusCode: 409});
  assert.equal(calls, 0);
  assert.equal((await handler(new Request('https://example.test/capabilities', {method: 'POST'}))).status, 405);
  assert.equal((await handler(new Request('https://example.test/other'))).status, 404);
});

test('SDK discovery and execution work through a real HTTP connection', async () => {
  const dispatcher = new CapabilityDispatcher({capabilities: [define('note.read', 'read', i => i)]});
  const handler = createCapabilityHttpHandler({dispatcher, resolveAccess: request => request.headers.get('authorization') === 'Bearer local' ? {actor, capabilities: ['note.read']} : null});
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await handler(new Request(`http://127.0.0.1${req.url}`, {method: req.method, headers: req.headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : {body: Buffer.concat(chunks)})}));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const client = new CapabilityHttpClient({url: `http://127.0.0.1:${server.address().port}/capabilities`, headers: () => ({authorization: 'Bearer local'})});
    assert.equal((await client.list()).length, 1);
    assert.equal((await client.invoke('note.read', 'over HTTP')).result, 'over HTTP');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
