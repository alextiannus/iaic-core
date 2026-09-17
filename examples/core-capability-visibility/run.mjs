import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {defineCapability,CapabilityDispatcher} from '@immedi/iaic-core/capabilities/index.js';
import {createCapabilityHttpHandler} from '@immedi/iaic-core/http/server.js';
import {createCapabilityMcpServer} from '@immedi/iaic-core/mcp/server.js';
import {ContextAssembler} from '@immedi/iaic-core/context/index.js';
import {AgentRuntime} from '@immedi/iaic-core/agent/runtime.js';import {TaskStore} from '@immedi/iaic-core/tasks/store.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
const actor={subjectId:'owner',scopeId:'fixture'},input={type:'object',additionalProperties:false};let effects=0,policyCalls=0,permitted=true;
const receipts=new Map();
const definition=visibility=>({name:'transfer.prepare',description:'Fixture Host transport operation',visibility,input,output:{type:'object'},effect:'write',retry:'idempotent',authorize:a=>a.subjectId===actor.subjectId&&permitted,revalidate:(_i,r)=>r,implementation:{kind:'function',execute:(_i,{callId})=>{if(!receipts.has(callId)){effects++;receipts.set(callId,{secret:'fixture-signed-reference'});}return receipts.get(callId);}}});
const hidden=defineCapability(definition('host'));
const read=defineCapability({name:'fixture.read',description:'Model-visible read',visibility:'model',input,output:{type:'object'},effect:'read',authorize:()=>true,revalidate:(_i,r)=>r,implementation:{kind:'function',execute:()=>({ok:true})}});
const dispatcher=new CapabilityDispatcher({capabilities:[hidden,read],executionPolicy:{check:()=>{policyCalls++;return {allowed:true,recordId:'fixture-policy',revision:'1',reason:'fixture'};}}});
assert.throws(()=>defineCapability(definition('invalid')),{code:'INVALID_CAPABILITY_VISIBILITY'});
assert.deepEqual(Object.keys(dispatcher.toolsFor(actor)),['fixture.read']);
const cached=dispatcher.toolsFor(actor)['fixture.read'];
assert.throws(()=>dispatcher.toolsFor(actor,{surface:'invalid'}),{code:'INVALID_CAPABILITY_SURFACE'});
await assert.rejects(dispatcher.invoke(hidden.name,{}, {actor,surface:'model',callId:'guess'}),{code:'CAPABILITY_SURFACE_DENIED'});
await assert.rejects(dispatcher.invoke(hidden.name,{}, {actor}),/stable call ID/);
await assert.rejects(dispatcher.invoke(hidden.name,{}, {actor:{...actor,subjectId:'other'},callId:'cross'}),{statusCode:403});
for(let i=0;i<2;i++)await dispatcher.invoke(hidden.name,{}, {actor,callId:'host-key'});
assert.equal(effects,1);assert.equal(policyCalls,2);
permitted=false;await assert.rejects(dispatcher.invoke(hidden.name,{}, {actor,callId:'revoked'}),{statusCode:403});permitted=true;
const resolveAccess=()=>({actor,capabilities:[hidden.name,read.name]});
const modelHttp=createCapabilityHttpHandler({dispatcher,resolveAccess});
const hostHttp=createCapabilityHttpHandler({dispatcher,resolveAccess,surface:'host'});
assert.deepEqual((await (await modelHttp(new Request('http://fixture/capabilities'))).json()).capabilities.map(c=>c.name),[read.name]);
assert.deepEqual((await (await hostHttp(new Request('http://fixture/capabilities'))).json()).capabilities.map(c=>c.name),[hidden.name]);
const post=(name,body)=>new Request('http://fixture/capabilities/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const denied=await modelHttp(post(hidden.name,{input:{},requestKey:'guess'}));assert.equal(denied.status,403);assert.equal((await denied.json()).error.code,'CAPABILITY_SURFACE_DENIED');
assert.equal((await modelHttp(post(read.name,{input:{},surface:'host'}))).status,400);
assert.equal((await hostHttp(post(hidden.name,{input:{},requestKey:'host-key'}))).status,200);assert.equal(effects,1);
async function mcp(surface,run){const server=createCapabilityMcpServer({dispatcher,resolveAccess,surface});const client=new Client({name:'fixture',version:'1'});const [ct,st]=InMemoryTransport.createLinkedPair();try{await server.connect(st);await client.connect(ct);await run(client);}finally{await client.close();await server.close();}}
await mcp('model',async client=>{assert.deepEqual((await client.listTools()).tools.map(t=>t.name),[read.name]);const r=await client.callTool({name:hidden.name,arguments:{input:{},requestKey:'guess'}});assert.equal(JSON.parse(r.content[0].text).error.code,'CAPABILITY_SURFACE_DENIED');});
await mcp('host',async client=>{assert.deepEqual((await client.listTools()).tools.map(t=>t.name),[hidden.name]);assert.equal((await client.callTool({name:hidden.name,arguments:{input:{},requestKey:'host-key'}})).isError,undefined);});
// A cached model tool handler cannot override its surface through execution options.
dispatcher.capabilities.set(read.name,defineCapability({...read,visibility:'host'}));
await assert.rejects(cached.handler({}, {surface:'host'}),{code:'CAPABILITY_SURFACE_DENIED'});
const history={calls:[{id:randomUUID(),capability:hidden.name,input:{},status:'succeeded',result:{secret:'fixture-signed-reference'}}],events:[]};
await assert.rejects(new ContextAssembler({}).revalidateHistory({history,actor,dispatcher}),{code:'CAPABILITY_SURFACE_DENIED'});assert.equal(history.calls[0].result.secret,'fixture-signed-reference');
// Real persistent Runtime: model guesses a hidden name; later policy upgrade
// blocks old results even with an application context assembler that skips checks.
const url=process.env.DATABASE_URL||process.env.SUBMISSION_TEST_DATABASE_URL;
if(!url)throw Error('Isolated PostgreSQL required');
const admin=new Pool({connectionString:url}),schema='visibility_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});let runtime;
try{
 const store=new TaskStore({pool});let modelCalls=0;
 const agent=defineCapability({name:'agent.work',description:'Visibility fixture',input:{type:'object'},output:{type:'object'},effect:'read',authorize:()=>true,implementation:{kind:'agent',instructions:'Fixture',tools:[hidden.name],verify:()=>true}});
 const registry=new CapabilityDispatcher({capabilities:[hidden,agent]});
 runtime=new AgentRuntime({store,dispatcher:registry,context:new ContextAssembler({}),version:'visibility-v1',model:{name:'fixture',next:async({tools,messages})=>{assert.equal(tools.length,0);assert.ok(!JSON.stringify(messages).includes('fixture-signed-reference'));modelCalls++;return modelCalls===1?{type:'call',name:hidden.name,input:{}}:{type:'wait',question:'Need Host input'};}}});registry.tasks=runtime;await runtime.initialize();
 const task=await runtime.create({capability:agent,input:{goal:'Fixture'},actor,idempotencyKey:'hidden-task'});assert.equal((await runtime.tick()).waiting_reason,'input');assert.equal(effects,1);assert.ok((await store.history(actor,task.id)).events.some(e=>e.kind==='feedback'&&e.data.code==='CAPABILITY_SURFACE_DENIED'));
 await runtime.stop();
 // An older both-visible result exists before the declaration tightens to Host.
 const formerlyVisible=defineCapability(definition('both'));registry.capabilities.set(hidden.name,formerlyVisible);modelCalls=0;
 runtime=new AgentRuntime({store,dispatcher:registry,context:new ContextAssembler({}),version:'visibility-v1',model:{name:'fixture',next:async()=>++modelCalls===1?{type:'call',name:hidden.name,input:{}}:{type:'wait',question:'Pause'}}});await runtime.initialize();
 const old=await runtime.create({capability:agent,input:{goal:'Old policy'},actor,idempotencyKey:'old-task'});assert.equal((await runtime.tick()).waiting_reason,'input');const before=effects;await runtime.transition(actor,old.id,{action:'provide_input',input:'Continue',requestKey:'continue'});await runtime.stop();
 registry.capabilities.set(hidden.name,hidden);modelCalls=0;
 runtime=new AgentRuntime({store,dispatcher:registry,context:{assemble:async()=>[{role:'user',content:'must never reach model'}]},version:'visibility-v1',model:{name:'fixture',next:async()=>{modelCalls++;return {type:'finish',result:{}};}}});await runtime.initialize();
 const result=await runtime.tick();assert.equal(result.waiting_reason,'interrupted');assert.equal(result.error,'CAPABILITY_SURFACE_DENIED');assert.equal(modelCalls,0);assert.equal(effects,before);
 await assert.rejects(runtime.get(actor,old.id),{code:'CAPABILITY_SURFACE_DENIED'});assert.equal((await runtime.state(actor,old.id)).status,'waiting');
 console.log(JSON.stringify({capabilityVisibility:true,httpAndMcp:true,hostAuthorization:true,stableKeyPreserved:true,modelGuessDenied:true,cachedHandlerDenied:true,oldHistoryBlocked:true,customContextCannotBypass:true,realPostgres:true}));
}finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
