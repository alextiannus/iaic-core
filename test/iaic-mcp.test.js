import Ajv from 'ajv';
import test from 'node:test';import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createCapabilityMcpServer} from '@immedi/iaic-core/mcp/server.js';import {CapabilityDispatcher,defineCapability} from '@immedi/iaic-core/capabilities/index.js';
const input={type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},output={type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false};
const actor={subjectId:'reader',scopeId:'notes'};
async function connected(dispatcher,resolveAccess,run){const server=createCapabilityMcpServer({dispatcher,resolveAccess});const client=new Client({name:'neutral-client',version:'1'});const [ct,st]=InMemoryTransport.createLinkedPair();try{await server.connect(st);await client.connect(ct);await run(client);}finally{await client.close();await server.close();}}
const value=response=>JSON.parse(response.content[0].text);
test('Core MCP preserves schemas/results, transports stable keys and rechecks current scoped access',async()=>{
 let access={actor,capabilities:['note.read','note.write']},writes=0;const records=new Map();
 const read=defineCapability({name:'note.read',description:'Read a note',input,output,effect:'read',authorize:async a=>a.subjectId==='reader',implementation:{kind:'function',execute:async i=>i}});
 const write=defineCapability({name:'note.write',description:'Store by request key',input,output,effect:'write',retry:'idempotent',authorize:async a=>a.subjectId==='reader',implementation:{kind:'function',execute:async(i,{callId})=>{if(!records.has(callId)){records.set(callId,i);writes++;}else if(records.get(callId).value!==i.value)throw Object.assign(new Error('Changed payload'),{statusCode:409});return records.get(callId);}}});const dispatcher=new CapabilityDispatcher({capabilities:[read,write]});
 await connected(dispatcher,async()=>access,async client=>{
  const {tools}=await client.listTools();assert.deepEqual(tools.map(t=>t.name),access.capabilities);const { $id,...businessInput}=tools[0].inputSchema.properties.input;assert.deepEqual(businessInput,read.input);assert.deepEqual(tools[0].outputSchema,read.output);assert.equal(tools[0].annotations.readOnlyHint,true);assert.equal(tools[1]._meta['iaic/requestKeyRequired'],true);
  const direct=await dispatcher.invoke('note.read',{value:'current'},{actor});const fromMcp=await client.callTool({name:'note.read',arguments:{input:{value:'current'}}});assert.deepEqual(value(fromMcp),direct);assert.deepEqual(fromMcp.structuredContent,direct);
  const missing=await client.callTool({name:'note.write',arguments:{input:{value:'first'}}});assert.equal(value(missing).error.statusCode,400);assert.equal(writes,0);
  const call={name:'note.write',arguments:{input:{value:'first'},requestKey:'stable-key'}};assert.deepEqual(value(await client.callTool(call)),{value:'first'});assert.deepEqual(value(await client.callTool(call)),{value:'first'});assert.equal(writes,1);
  const invalid=await client.callTool({name:'note.read',arguments:{input:{value:42}}});assert.equal(value(invalid).error.statusCode,400);assert.ok(value(invalid).error.validation.length);
  const spoof=await client.callTool({name:'note.write',arguments:{input:{value:'next',actor:{subjectId:'admin'}},requestKey:'new'}});assert.equal(value(spoof).error.statusCode,400);assert.equal(writes,1);
  access={actor:{...actor,subjectId:'denied'},capabilities:['note.read']};assert.equal(value(await client.callTool({name:'note.read',arguments:{input:{value:'secret'}}})).error.statusCode,403);
  access={actor,capabilities:[]};assert.equal((await client.listTools()).tools.length,0);await assert.rejects(client.callTool(call),/not available/);assert.equal(writes,1);
 });
});
test('Core MCP preserves array results, identifies Task admission and reports unknown writes without retries',async()=>{
 let attempts=0,admissions=0;
 const array=defineCapability({name:'notes.list',description:'List',input:{type:'object',properties:{},additionalProperties:false},output:{type:'array',items:{type:'string'}},effect:'read',authorize:async()=>true,implementation:{kind:'function',execute:async()=>['note']}});
 const uncertain=defineCapability({name:'notes.submit',description:'Submit once',input,output,effect:'write',retry:'never-replay',authorize:async()=>true,implementation:{kind:'function',execute:async()=>{attempts++;throw new Error('Internal credential must not be disclosed');}}});
 const agent=defineCapability({name:'notes.assist',description:'Perform work',input,output,effect:'read',authorize:async()=>true,implementation:{kind:'agent',instructions:'Read',tools:['notes.list'],verify:async()=>true}});
 const dispatcher=new CapabilityDispatcher({capabilities:[array,uncertain,agent],tasks:{create:async({idempotencyKey})=>{admissions++;return {id:'task-id',status:'queued',requestKey:idempotencyKey};}}});
 await connected(dispatcher,async()=>({actor,capabilities:[array.name,uncertain.name,agent.name]}),async client=>{
  const {tools}=await client.listTools();assert.equal(tools[0].outputSchema,undefined);assert.deepEqual(value(await client.callTool({name:'notes.list',arguments:{input:{}}})),['note']);assert.equal(tools[2].outputSchema,undefined);assert.equal(tools[2]._meta['iaic/result'],'task-receipt');assert.equal(tools[2].annotations.readOnlyHint,false);
  assert.equal((await client.callTool({name:'notes.assist',arguments:{input:{value:'goal'}}})).isError,true);assert.equal(admissions,0);
  const receipt=value(await client.callTool({name:'notes.assist',arguments:{input:{value:'goal'},requestKey:'task-key'}}));assert.equal(receipt.status,'queued');assert.equal(receipt.requestKey,'task-key');
  const failed=await client.callTool({name:'notes.submit',arguments:{input:{value:'send'},requestKey:'uncertain'}});assert.equal(failed.isError,true);assert.equal(value(failed).error.outcomeUnknown,true);assert.equal(value(failed).error.requestKey,'uncertain');assert.equal(JSON.stringify(failed).includes('credential'),false);assert.equal(attempts,1);
 });
});


test('Transport envelope preserves local schema references and accepts non-object business inputs',async()=>{
 const schema={type:'object',$defs:{text:{type:'string',minLength:1}},properties:{value:{$ref:'#/$defs/text'}},required:['value'],additionalProperties:false};
 const caps=[defineCapability({name:'local.refs',description:'Referenced input',input:schema,output,effect:'read',authorize:async()=>true,implementation:{kind:'function',execute:async i=>i}}),defineCapability({name:'array.input',description:'Array input',input:{type:'array',items:{type:'string'}},output:{type:'array',items:{type:'string'}},effect:'read',authorize:async()=>true,implementation:{kind:'function',execute:async i=>i}})];
 caps.push(defineCapability({name:'scalar.input',description:'Scalar input',input:{type:'string'},output:{type:'string'},effect:'read',authorize:async()=>true,implementation:{kind:'function',execute:async i=>i}}));
 await connected(new CapabilityDispatcher({capabilities:caps}),async()=>({actor,capabilities:caps.map(c=>c.name)}),async client=>{
  const {tools}=await client.listTools();const valid=new Ajv({strict:false}).compile(tools[0].inputSchema);assert.equal(valid({input:{value:'word'}}),true);assert.equal(valid({input:{value:42}}),false);
  assert.deepEqual(value(await client.callTool({name:'local.refs',arguments:{input:{value:'word'}}})),{value:'word'});assert.deepEqual(value(await client.callTool({name:'array.input',arguments:{input:['one']}})),['one']);assert.equal(value(await client.callTool({name:'scalar.input',arguments:{input:'one'}})),'one');
 });
});
