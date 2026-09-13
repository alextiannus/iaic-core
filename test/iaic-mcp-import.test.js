import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {ListToolsRequestSchema, CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {discoverMcpTools, importMcpCapabilities} from '@immedi/iaic-core/mcp/client.js';
import {CapabilityDispatcher} from '@immedi/iaic-core';

const inputSchema = {type: 'object', properties: {value: {type: 'string'}}, required: ['value'], additionalProperties: false};
async function withRemote(run) {
  let calls = 0;
  const server = new Server({name: 'fixture', version: '1'}, {capabilities: {tools: {}}});
  server.setRequestHandler(ListToolsRequestSchema, async request => request.params?.cursor === 'second' ? {tools: [{name: 'write', description: 'External write', inputSchema}]} : {tools: [{name: 'read', description: 'External read', inputSchema}], nextCursor: 'second'});
  server.setRequestHandler(CallToolRequestSchema, async request => {
    calls++;
    if (request.params.arguments.value === 'fail') return {isError: true, content: [{type: 'text', text: 'external failure'}]};
    return {content: [{type: 'text', text: request.params.arguments.value}], structuredContent: {value: request.params.arguments.value}};
  });
  const client = new Client({name: 'importer', version: '1'});
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st); await client.connect(ct);
  try { await run(client, () => calls); } finally {await client.close(); await server.close();}
}

test('Imported MCP tools use explicit bindings, paginated discovery and current actor access', async () => {
  await withRemote(async (client, calls) => {
    let allowed = true, resolutions = 0;
    const caps = await importMcpCapabilities({client, resolveClient: async ({actor, tool}) => {assert.equal(actor.subjectId, 'user'); assert.equal(tool, 'read'); resolutions++; return client;}, bindings: [{name: 'external.read', tool: 'read', effect: 'read', authorize: () => allowed}]});
    assert.equal(caps.length, 1);
    assert.deepEqual(caps[0].input, inputSchema);
    const dispatcher = new CapabilityDispatcher({capabilities: caps});
    const result = await dispatcher.invoke('external.read', {value: 'remote result'}, {actor: {subjectId: 'user'}});
    assert.equal(result.structuredContent.value, 'remote result');
    assert.equal(result.content[0].text, 'remote result');
    allowed = false;
    await assert.rejects(dispatcher.invoke('external.read', {value: 'x'}, {actor: {subjectId: 'user'}}), {statusCode: 403});
    assert.equal(calls(), 1); assert.equal(resolutions, 1);
  });
});

test('Imported writes default to no replay and remote tool errors remain uncertain', async () => {
  await withRemote(async (client, calls) => {
    const caps = await importMcpCapabilities({client, resolveClient: () => client, bindings: [{name: 'external.write', tool: 'write', effect: 'write', authorize: () => true}]});
    assert.equal(caps[0].retry, 'never-replay');
    const dispatcher = new CapabilityDispatcher({capabilities: caps});
    await assert.rejects(dispatcher.invoke('external.write', {value: 'first'}, {actor: {subjectId: 'user'}}), {statusCode: 400});
    assert.equal(calls(), 0);
    await assert.rejects(dispatcher.invoke('external.write', {value: 'fail'}, {actor: {subjectId: 'user'}, callId: 'stable'}), error => error.outcomeUnknown === true && error.remoteResult.isError === true);
    assert.equal(calls(), 1);
    await assert.rejects(importMcpCapabilities({client, resolveClient: () => client, bindings: [{name: 'unsafe.write', tool: 'write', effect: 'write', retry: 'idempotent', authorize: () => true}]}), /stable-key/);
  });
});

test('Discovery rejects incomplete or looping catalogs and keeps schemas detached', async () => {
  await assert.rejects(discoverMcpTools({listTools: async () => ({tools: [], nextCursor: 'same'})}), /repeated/);
  await assert.rejects(discoverMcpTools({listTools: async () => ({tools: [], nextCursor: 'more'})}, {maxPages: 1}), /page limit/);
  const source = {name: 'read', inputSchema: structuredClone(inputSchema)};
  const tools = await discoverMcpTools({listTools: async () => ({tools: [source]})});
  tools[0].inputSchema.required.push('other');
  assert.deepEqual(source.inputSchema.required, ['value']);
});
