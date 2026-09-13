import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {defineCapability, CapabilityDispatcher} from '@immedi/iaic-core';
import {createCapabilityMcpServer} from '@immedi/iaic-core/mcp/server.js';
import {importMcpCapabilities} from '@immedi/iaic-core/mcp/client.js';

const actor = {subjectId: 'example-user'};
const input = {type: 'object', properties: {text: {type: 'string'}}, required: ['text'], additionalProperties: false};
const records = new Map(); let writes = 0;
const remote = new CapabilityDispatcher({capabilities: [defineCapability({
  name: 'notes.write', description: 'Store a note using a stable operation key', input, output: input,
  effect: 'write', retry: 'idempotent', authorize: current => current.subjectId === actor.subjectId,
  implementation: {kind: 'function', execute: (value, {callId}) => {
    if (!records.has(callId)) {records.set(callId, value); writes++;}
    else if (records.get(callId).text !== value.text) throw new Error('Changed payload for an existing operation');
    return records.get(callId);
  }}
})]});
const server = createCapabilityMcpServer({dispatcher: remote, resolveAccess: () => ({actor, capabilities: ['notes.write']})});
const client = new Client({name: 'core-import-example', version: '1'});
const [ct, st] = InMemoryTransport.createLinkedPair();
await server.connect(st); await client.connect(ct);
try {
  const capabilities = await importMcpCapabilities({client,
    resolveClient: ({actor: current}) => current.subjectId === actor.subjectId ? client : null,
    bindings: [{name: 'external.note', tool: 'notes.write', input, effect: 'write', retry: 'idempotent',
      authorize: current => current.subjectId === actor.subjectId,
      toArguments: (value, {callId}) => ({input: value, requestKey: callId})}]
  });
  const local = new CapabilityDispatcher({capabilities});
  for (let n = 0; n < 2; n++) {
    const result = await local.invoke('external.note', {text: 'A reusable external tool'}, {actor, callId: 'one-operation'});
    assert.equal(result.structuredContent.text, 'A reusable external tool');
  }
  assert.equal(writes, 1);
  console.log(JSON.stringify({example: 'core-mcp-import', status: 'passed', sharedDispatcher: true, domainDeduplication: true}));
} finally {await client.close(); await server.close();}
