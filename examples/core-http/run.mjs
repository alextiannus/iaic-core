import assert from 'node:assert/strict';
import {CapabilityDispatcher, defineCapability, createCapabilityHttpHandler} from '@immedi/iaic-core';
import {CapabilityHttpClient} from '@immedi/iaic-core/http/client.js';

const dispatcher = new CapabilityDispatcher({capabilities: [defineCapability({
  name: 'greeting.read', description: 'Return a greeting', effect: 'read',
  input: {type: 'string'}, output: {type: 'string'},
  authorize: actor => actor.subjectId === 'example-user',
  implementation: {kind: 'function', execute: name => `Hello ${name}`}
})]});
const handler = createCapabilityHttpHandler({dispatcher, resolveAccess: request => {
  if (request.headers.get('authorization') !== 'Bearer example-token') return null;
  return {actor: {subjectId: 'example-user'}, capabilities: ['greeting.read']};
}});
// Injected Fetch transport exercises the same Request/Response boundary without a listener.
const client = new CapabilityHttpClient({url: 'https://example.test/capabilities', headers: () => ({authorization: 'Bearer example-token'}), fetch: (url, init) => handler(new Request(url, init))});
assert.equal((await client.list())[0].name, 'greeting.read');
assert.deepEqual(await client.invoke('greeting.read', 'developer'), {resultKind: 'capability-result', result: 'Hello developer'});
console.log(JSON.stringify({example: 'core-http', status: 'passed'}));
