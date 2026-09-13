import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {MandateStore,AssistantMandates,AgentRuntime,TaskStore,ContextAssembler,CapabilityDispatcher,defineCapability} from '@immedi/iaic-core';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
async function database(run){const admin=new Pool({connectionString:url}),schema='mandates_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});try{await run(pool);}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}}
const actor={scopeId:'example',subjectId:'reader'},scope=a=>({applicationId:a.scopeId,assistantId:'helper',subjectId:a.subjectId});
const grantInput={requestKey:'authorization',capability:'draft',tools:['draft.write'],purpose:'Prepare drafts',expiresAt:'2099-01-01T00:00:00Z'};
const ports=store=>({store,resolveScope:async a=>scope(a),authorizeGrant:async()=>true,sourceFor:a=>({kind:'user-request',subject:a.subjectId})});
test('Mandates have immutable replayable terms, scoped ownership, expiry and irreversible revocation',{skip:!url},()=>database(async pool=>{
 const store=new MandateStore({pool});await store.initialize();let now=Date.parse('2026-01-01T00:00:00Z');const service=new AssistantMandates({...ports(store),clock:()=>now});
 const grants=await Promise.all(Array.from({length:6},()=>service.grant(actor,{...grantInput,source:{kind:'forged'}})));assert.equal(new Set(grants.map(g=>g.id)).size,1);const grant=grants[0];assert.equal(grant.source.kind,'user-request');
 const request={capability:'draft',input:{mandate:{id:grant.id},allowedTools:['draft.write']}};assert.equal((await service.checkTask(actor,request)).id,grant.id);
 await assert.rejects(service.grant(actor,{...grantInput,tools:['other']}),{statusCode:409});
 const other={...actor,subjectId:'other'};await assert.rejects(service.read(other,grant.id),{statusCode:404});await assert.rejects(service.revoke(other,grant.id),{statusCode:404});assert.equal((await service.list(other,{})).items.length,0);
 for(const bad of [{...request,capability:'admin'}, {...request,input:{...request.input,allowedTools:['other']}},{...request,input:{mandate:{id:grant.id}}},{...request,tool:'other'}])await assert.rejects(service.checkTask(actor,bad),{code:'MANDATE_DENIED'});
 now=Date.parse(grant.expiresAt);await assert.rejects(service.checkTask(actor,request),/expired/);now--;
 assert.equal((await service.checkTask(actor,request)).id,grant.id);
 const revoked=await service.revoke(actor,grant.id);assert.deepEqual(await service.revoke(actor,grant.id),revoked);assert.deepEqual(await service.grant(actor,grantInput),revoked);await assert.rejects(service.checkTask(actor,request),/revoked/);
 const rebuilt=new AssistantMandates(ports(new MandateStore({pool})));assert.deepEqual(await rebuilt.read(actor,grant.id),revoked);
 await assert.rejects(new AssistantMandates({...ports(store),authorizeGrant:async()=>false}).grant(actor,{...grantInput,requestKey:'denied'}),{statusCode:403});
 await service.grant(actor,{...grantInput,requestKey:'second'});const first=await service.list(actor,{limit:1});assert.ok(first.next);const second=await service.list(actor,{after:first.next,limit:1});assert.equal(second.items.length,1);assert.notEqual(first.items[0].id,second.items[0].id);
 const precise=await service.grant(actor,{...grantInput,requestKey:'precise',expiresAt:'2099-01-01T00:00:00.123456Z'});assert.equal(precise.expiresAt.toISOString(),'2099-01-01T00:00:00.123Z');assert.equal((await service.grant(actor,{...grantInput,requestKey:'precise',expiresAt:'2099-01-01T00:00:00.123Z'})).id,precise.id);
 await assert.rejects(service.grant(actor,{...grantInput,expiresAt:'2099'}),{statusCode:400});
}));
test('Runtime revocation during inference blocks the proposed action, keeps history/cancellation, and cannot omit its resolver',{skip:!url},()=>database(async pool=>{
 const mandatesStore=new MandateStore({pool});await mandatesStore.initialize();const mandates=new AssistantMandates(ports(mandatesStore));
 const grant=await mandates.grant(actor,grantInput);let calls=0,writes=0;
 const action=defineCapability({name:'draft.write',description:'Write one draft',input:{type:'object'},output:{type:'object'},effect:'write',retry:'never-replay',authorize:async()=>true,implementation:{kind:'function',execute:async()=>{writes++;return {};}}});
 const agent=defineCapability({name:'draft',description:'Prepare draft',input:{type:'object'},output:{type:'object'},effect:'write',retry:'never-replay',authorize:async()=>true,implementation:{kind:'agent',instructions:'Prepare draft',tools:['draft.write'],verify:async()=>true}});
 const store=new TaskStore({pool}),dispatcher=new CapabilityDispatcher({capabilities:[agent,action]});
 const model={name:'mandate-fixture',next:async()=>{calls++;await mandates.revoke(actor,grant.id);return {type:'call',name:'draft.write',input:{}};}};
 const runtime=new AgentRuntime({store,dispatcher,model,context:new ContextAssembler({skillRoot:process.cwd()}),version:'mandates-v1',mandates});dispatcher.tasks=runtime;
 let without;
 try{
  await runtime.initialize();const input={goal:'Draft',mandate:{id:grant.id},allowedTools:['draft.write']};const task=await runtime.create({capability:agent,input,actor,idempotencyKey:'bound'});
  const stopped=await runtime.tick();assert.equal(stopped.status,'waiting');assert.match(stopped.error,/revoked/);assert.equal(writes,0);assert.equal(calls,1);assert.equal((await runtime.get(actor,task.id,{history:true})).calls.length,0);
  await assert.rejects(runtime.checkAgent(actor,task),{code:'MANDATE_DENIED'});
  await assert.rejects(runtime.transition(actor,task.id,{action:'resume'}),{code:'MANDATE_DENIED'});
  assert.equal((await runtime.transition(actor,task.id,{action:'cancel'})).status,'cancelled');
  const another=await mandates.grant(actor,{...grantInput,requestKey:'another'});const pending=await runtime.create({capability:agent,input:{...input,mandate:{id:another.id}},actor,idempotencyKey:'resolver-required'});
  await runtime.stop();without=new AgentRuntime({store,dispatcher,model,context:new ContextAssembler({skillRoot:process.cwd()}),version:'mandates-v1'});await without.initialize();const blocked=await without.tick();assert.equal(blocked.id,pending.id);assert.equal(blocked.status,'waiting');assert.match(blocked.error,/resolver is unavailable/);assert.equal(calls,1);
 }finally{await without?.stop();await runtime.stop();}
}));

test('A live Mandate narrows model discovery and blocks a fabricated tool even without a capability-specific allowCall',{skip:!url},()=>database(async pool=>{
 const store=new MandateStore({pool});await store.initialize();const mandates=new AssistantMandates(ports(store));const grant=await mandates.grant(actor,grantInput);let writes=0;
 const actions=['draft.write','other.write'].map(name=>defineCapability({name,description:name,input:{type:'object'},output:{type:'object'},effect:'write',retry:'never-replay',authorize:async()=>true,implementation:{kind:'function',execute:async()=>{writes++;return {};}}}));
 const agent=defineCapability({name:'draft',description:'Draft',input:{type:'object'},output:{type:'object'},effect:'write',retry:'never-replay',authorize:async()=>true,implementation:{kind:'agent',instructions:'Draft',tools:actions.map(a=>a.name),verify:async()=>true}});
 const tasks=new TaskStore({pool}),dispatcher=new CapabilityDispatcher({capabilities:[agent,...actions]});const runtime=new AgentRuntime({store:tasks,dispatcher,mandates,version:'mandate-tool-v1',context:new ContextAssembler({skillRoot:process.cwd()}),model:{name:'fabricated-tool',next:async({tools})=>{assert.deepEqual(tools.map(t=>t.name),['draft.write']);return {type:'call',name:'other.write',input:{}};}}});dispatcher.tasks=runtime;
 try{await runtime.initialize();const input={mandate:{id:grant.id},allowedTools:['draft.write']};
  await assert.rejects(runtime.create({capability:{...agent,authorize:async()=>false},actor,input,idempotencyKey:'no-permission'}),{statusCode:403});
  const task=await runtime.create({capability:agent,actor,input,idempotencyKey:'fabricated'});const stopped=await runtime.tick();assert.equal(stopped.status,'waiting');assert.match(stopped.error,/exceeds Mandate scope/);assert.equal(writes,0);assert.equal((await tasks.history(actor,task.id)).calls.length,0);
 }finally{await runtime.stop();}
}));
