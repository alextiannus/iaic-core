import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {HostTaskContext,hostProjection} from '../context/host.js';import {TaskStore} from '../tasks/store.js';import {AgentRuntime} from '../agent/runtime.js';import {ContextAssembler} from '../context/index.js';import {defineCapability,CapabilityDispatcher} from '../capabilities/index.js';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
test('Host projection and restored Actor remain separate, durable and currently authorized',{skip:!url},async()=>{
 const admin=new Pool({connectionString:url}),schema='host_context_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});let runtime;
 try{
  await pool.query('CREATE TABLE app_snapshots(reference text PRIMARY KEY, projection jsonb NOT NULL)');await pool.query('INSERT INTO app_snapshots VALUES($1,$2)',['context-a',{principalId:'principal-a',contextRevision:1}]);
  const actor={scopeId:'app',subjectId:'owner'},store=new TaskStore({pool});let current='context-a',revision=1,permission=true,projectionVersion='v1',writes=0,models=0,service;
  const open=async()=>{
   await runtime?.stop();
   service=new HostTaskContext({bind:async request=>{assert.equal('input' in request,false);return {schema:'app.identity',version:projectionVersion,reference:'context-a',revision:'1',projection:(await pool.query('SELECT projection FROM app_snapshots WHERE reference=$1',['context-a'])).rows[0].projection};},resolve:async({binding})=>(await pool.query('SELECT projection FROM app_snapshots WHERE reference=$1',[binding.reference])).rows[0].projection,authorize:async({actor:a,binding})=>a.subjectId===actor.subjectId&&current===binding.reference&&revision>=Number(binding.revision)&&permission,readTask:(a,id)=>store.get(a,id),restoreActor:async({actor:a})=>({...a,principalId:'principal-a',contextRevision:revision})});
   const shape={type:'object'},write=defineCapability({name:'records.write',description:'Host-authorized fixture',input:shape,output:shape,effect:'write',retry:'never-replay',authorize:a=>a.subjectId===actor.subjectId,preflight:async(_input,c)=>Boolean(await service.restoreActor({actor:c.actor,taskId:c.taskId})),implementation:{kind:'function',execute:async(_input,c)=>{const restored=await service.restoreActor({actor:c.actor,taskId:c.taskId});writes++;return {principalId:restored.principalId};}},revalidate:async(_input,result,c)=>{assert.ok(c.taskId);await service.restoreActor({actor:c.actor,taskId:c.taskId});return result;}});
   const agent=defineCapability({name:'agent.work',description:'Host fixture',input:shape,output:shape,effect:'read',authorize:()=>true,implementation:{kind:'agent',instructions:'Use Host projection',tools:['records.write'],verify:()=>true}}),dispatcher=new CapabilityDispatcher({capabilities:[agent,write]});
   const model={name:'fixture',next:async({messages})=>{models++;const host=messages.find(m=>m.role==='system'&&m.content.includes('"hostContext"'));assert.ok(host);const data=JSON.parse(host.content.slice(host.content.indexOf('{')));assert.equal(data.hostContext.data.principalId,'principal-a');assert.equal(data.hostContext.source,'host');const user=JSON.parse(messages.find(m=>m.role==='user').content);assert.equal(user.goal.hostContext.principalId,'forged');return !user.calls.length?{type:'call',name:'records.write',input:{principalId:'forged'}}:user.events.some(e=>e.kind==='input')?{type:'finish',result:{done:true}}:{type:'wait',question:'Continue?'};}};
   runtime=new AgentRuntime({store,dispatcher,model,context:new ContextAssembler({skillRoot:'/tmp'}),version:'v1',trustedContext:service});dispatcher.tasks=runtime;await runtime.initialize();
  };
  await open();const input={goal:'Test',hostContext:{principalId:'forged'},trustedContext:{reference:'forged'}},task=await runtime.dispatcher.invoke('agent.work',input,{actor,callId:'original'});
  assert.equal((await runtime.tick()).waiting_reason,'input');assert.equal(writes,1);const binding=(await store.get(actor,task.id)).trusted_context;assert.equal(binding.reference,'context-a');assert.equal('projection' in binding,false);assert.ok(!JSON.stringify((await store.history(actor,task.id)).events.find(e=>e.kind==='created')).includes('principal-a'));
  revision=2;await open();assert.equal((await runtime.get(actor,task.id)).status,'waiting');assert.equal((await service.restoreActor({actor,taskId:task.id})).contextRevision,2);
  current='context-b';for(const action of ['resume','cancel','provide_input'])await assert.rejects(runtime.transition(actor,task.id,{action,input:'yes'}),{statusCode:403});current='context-a';
  await assert.rejects(service.restoreActor({actor:{...actor,subjectId:'other'},taskId:task.id}),{statusCode:404});
  permission=false;await assert.rejects(runtime.get(actor,task.id),{statusCode:403});permission=true;
  await pool.query('UPDATE app_snapshots SET projection=$1 WHERE reference=$2',[{principalId:'tampered'},'context-a']);await assert.rejects(service.project({actor,task:await store.get(actor,task.id)}),/original snapshot/);
  await pool.query('UPDATE app_snapshots SET projection=$1 WHERE reference=$2',[{contextRevision:1,principalId:'principal-a'},'context-a']); // key order cannot change digest
  projectionVersion='v2';await assert.rejects(runtime.dispatcher.invoke('agent.work',input,{actor,callId:'original'}),{statusCode:409});assert.equal((await service.project({actor,task:await store.get(actor,task.id)})).version,'v1');
  runtime.trustedContext=null;await assert.rejects(runtime.get(actor,task.id),{statusCode:503});runtime.trustedContext=service;
  await runtime.transition(actor,task.id,{action:'provide_input',input:'yes'});assert.equal((await runtime.tick()).status,'succeeded');assert.equal(writes,1);assert.equal(models,3);
  await assert.rejects(service.restoreActor({actor,taskId:''}),{statusCode:403});
  service.restore=async()=>({...actor,subjectId:'other'});await assert.rejects(service.restoreActor({actor,taskId:task.id}),{statusCode:403});
 }finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
test('Host projection bounds plain JSON and capability naming reports a stable pattern',()=>{
 assert.equal(hostProjection({b:2,a:1}).digest,hostProjection({a:1,b:2}).digest);
 for(const v of [{v:undefined},{v:Infinity},{v:new Date()},{v:'x'.repeat(16385)}])assert.throws(()=>hostProjection(v),{code:'HOST_CONTEXT_REJECTED'});
 assert.throws(()=>defineCapability({name:'12eat.read'}),{code:'INVALID_CAPABILITY_NAME',pattern:'^[a-z][a-z0-9_.-]*$'});
});

test('ordinary Agent starter wires Host-only ports into real durable and metered Runtime',{skip:!url},async()=>{
 const {openApplication}=await import('../developer/templates/agent/app.mjs');const fixtureOptions={job:{id:'assistant',purpose:'Fixture',capabilities:['agent.work'],configuration:{skills:[],knowledge:[],tools:[]}},skillRoot:'/tmp',version:'v1',profiles:[{id:'system',provider:'openai',model:'fixture',credentialRef:'fixture'}],resolveSecret:()=> 'fixture',authorize:()=>true,tokenPolicies:{system:{maximum:100,price:{revision:'v1',input:1,output:1,cachedInput:1}}}};
 const admin=new Pool({connectionString:url}),schema='host_starter_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});let app;
 try{
  const actor={scopeId:'app',subjectId:'owner'},projection={principalId:'host-principal'};
  app=await openApplication({pool,...fixtureOptions,hostContext:{bind:async()=>({schema:'identity',version:'v1',reference:'source',revision:'1',projection}),resolve:async()=>projection,authorize:()=>true,restoreActor:async({actor:a})=>({...a,principalId:projection.principalId})},modelFactory:()=>({next:async({messages})=>{assert.ok(messages.some(m=>m.role==='system'&&m.content.includes('host-principal')));return {type:'finish',result:{summary:'Host context present',artifacts:[]},usage:{inputTokens:1,outputTokens:1}};}}),verifyOutcome:()=>true});
  await app.ledger.grant(await app.scope(actor),{reference:'fixture',amount:1000,evidence:{fixture:true}});
  const task=await app.dispatcher.invoke('agent.work',{goal:'Test',allowedTools:[]},{actor,callId:'bound'});assert.equal((await app.runtime.tick()).status,'succeeded');assert.equal((await app.hostContext.restoreActor({actor,taskId:task.id})).principalId,'host-principal');assert.equal((await app.ledger.balance(await app.scope(actor))).reserved,'0');
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
