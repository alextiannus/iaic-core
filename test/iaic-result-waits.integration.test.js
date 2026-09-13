import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {TaskStore,AgentRuntime,CapabilityDispatcher,defineCapability,ContextAssembler} from '@immedi/iaic-core';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
const object={type:'object',additionalProperties:true};
test('Durable read-result waits survive Runtime replacement, make no waiting model calls and fence stale wakes',{skip:!url},async()=>{
 const admin=new Pool({connectionString:url}),schema='result_waits_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});let runtime;
 const actor={scopeId:'fixture',subjectId:'owner'},store=new TaskStore({pool});let ready=false,allowed=true,turns=0,reads=0;
 const execute=async()=>{reads++;return {ready};};
 const read=defineCapability({name:'receipt.await',description:'Await receipt',effect:'read',input:object,output:object,authorize:async()=>allowed,implementation:{kind:'function',execute},revalidate:execute,waitReady:(_i,r)=>r.ready===true});
 const agent=defineCapability({name:'agent.run',description:'Do work',input:object,output:object,effect:'read',authorize:async()=>allowed,implementation:{kind:'agent',instructions:'Await receipt then finish.',tools:[read.name],verify:async()=>ready}});
 const dispatcher=new CapabilityDispatcher({capabilities:[read,agent]}),model={name:'fixture',next:async()=>++turns===1?{type:'call',name:read.name,input:{}}:{type:'finish',result:{done:true}}};
 const createRuntime=version=>new AgentRuntime({store,dispatcher,model,version,context:new ContextAssembler({})});
 try{
  runtime=createRuntime('v1');await runtime.initialize();const task=await runtime.create({actor,capability:agent,input:{},idempotencyKey:'wait'});
  assert.equal((await runtime.tick()).waiting_reason,'external_result');assert.equal(turns,1);
  let wait=await store.pendingResultWait('v1');assert.equal(wait.id,task.id);assert.equal((await store.history(actor,task.id)).calls.length,1);
  await runtime.stop();runtime=createRuntime('v1');await runtime.initialize();runtime.resultWaits.intervalMs=0;
  for(let i=0;i<3;i++)assert.equal(await runtime.tick(),null);assert.equal(turns,1);assert.ok(reads>=4);
  ready=true;allowed=false;assert.equal(await runtime.tick(),null);assert.equal((await store.get(actor,task.id)).status,'waiting');
  allowed=true;assert.equal(await store.pendingResultWait('v2'),null);
  assert.equal(await store.wakeResultWait({...actor,subjectId:'other'},task.id,{version:'v1',waitSeq:wait.wait_seq,callId:wait.wait_call_id}),false);
  assert.equal((await runtime.tick()).status,'succeeded');assert.equal(turns,2);
  assert.equal(await store.wakeResultWait(actor,task.id,{version:'v1',waitSeq:wait.wait_seq,callId:wait.wait_call_id}),false);
  const h=await store.history(actor,task.id);assert.equal(h.calls.length,1);assert.equal(h.events.filter(e=>e.kind==='result_ready').length,1);
  // Explicit input waits and cancellation cannot be awakened by an old result receipt.
  ready=false;turns=0;const cancelled=await runtime.create({actor,capability:agent,input:{},idempotencyKey:'cancel'});await runtime.tick();wait=await store.pendingResultWait('v1');assert.equal(wait.id,cancelled.id);
  await runtime.transition(actor,cancelled.id,{action:'cancel'});ready=true;assert.equal(await runtime.tick(),null);assert.equal(turns,1);
  assert.equal(await store.wakeResultWait(actor,cancelled.id,{version:'v1',waitSeq:wait.wait_seq,callId:wait.wait_call_id}),false);
  ready=false;turns=0;const manual=await runtime.create({actor,capability:agent,input:{},idempotencyKey:'manual'});await runtime.tick();wait=await store.pendingResultWait('v1');
  await runtime.transition(actor,manual.id,{action:'resume'});
  model.next=async()=>{turns++;return {type:'wait',question:'User choice required'};};await runtime.tick();
  assert.equal((await store.get(actor,manual.id)).waiting_reason,'input');ready=true;
  assert.equal(await store.wakeResultWait(actor,manual.id,{version:'v1',waitSeq:wait.wait_seq,callId:wait.wait_call_id}),false);
  assert.equal(await runtime.tick(),null);assert.equal(turns,2);
 }finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
