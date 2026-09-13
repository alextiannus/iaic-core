import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {usageDiagnostic} from '@immedi/iaic-core/agent/usage-diagnostic.js';
import {TokenLedger,meteredModel,AgentRuntime,TaskStore,ContextAssembler,CapabilityDispatcher,defineCapability} from '@immedi/iaic-core';
test('Usage diagnostics contain only bounded structured fields',()=>{
 const requestId=randomUUID();assert.deepEqual(usageDiagnostic({requestId,kind:'http',providerStatus:429,retryAfterMs:1000,providerCompleted:false,message:'secret',body:{key:'secret'},headers:{authorization:'secret'}}),{requestId,kind:'http',providerStatus:429,retryAfterMs:1000,providerCompleted:false});
 assert.equal(usageDiagnostic({requestId:'secret'}),null);assert.deepEqual(usageDiagnostic({requestId,kind:'secret',providerStatus:200,retryAfterMs:Infinity,providerCompleted:'yes'}),{requestId});
});
test('Unknown provider usage retains a safe cause and original request in ledger and Task history without retry or release',async()=>{
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;assert.ok(connectionString);const schema='usage_diagnostic_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let runtime;
 try{
  const ledger=new TokenLedger({pool});await ledger.initialize();const actor={subjectId:'user',scopeId:'app'},scope={applicationId:'app',subjectId:'user'};await ledger.grant(scope,{reference:'fixture',amount:100,evidence:{fixture:true}});let calls=0;
  const provider={name:'fixture',next:async()=>{calls++;throw Object.assign(new Error('secret-provider-body-must-not-be-copied'),{providerStatus:429,retryAfterMs:1000,headers:{authorization:'secret'}});}};
  const model=meteredModel({model:provider,ledger,scope,policy:{maximum:20,price:{revision:'fixture',input:1,cachedInput:1,output:1}}});
  const agent=defineCapability({name:'work',description:'Complete verified work',input:{type:'object'},output:{type:'object'},effect:'read',authorize:()=>true,implementation:{kind:'agent',instructions:'Finish',tools:[],verify:()=>true}});
  const store=new TaskStore({pool}),dispatcher=new CapabilityDispatcher({capabilities:[agent]});runtime=new AgentRuntime({store,dispatcher,model,context:new ContextAssembler({}),version:'fixture',rateLimitDelayMs:0});dispatcher.tasks=runtime;await runtime.initialize();
  const task=await runtime.create({actor,capability:agent,input:{goal:'Complete'},idempotencyKey:'original'});assert.equal((await runtime.tick()).waiting_reason,'usage_reconciliation');assert.equal(calls,1);
  const pending=await ledger.pending(scope);assert.equal(pending.length,1);assert.equal(pending[0].state,'unknown');assert.equal((await ledger.balance(scope)).reserved,'20');
  const expected={requestId:pending[0].request_id,kind:'http',providerStatus:429,retryAfterMs:1000};const history=await store.history(actor,task.id);assert.deepEqual(history.events.find(e=>e.kind==='model_usage').data.diagnostic,expected);
  const entry=(await ledger.entries(scope)).find(e=>e.kind==='unknown');assert.deepEqual(entry.evidence,{reason:'usage_unavailable',diagnostic:expected});assert.ok(!JSON.stringify({entry,history}).includes('secret'));assert.ok(!history.events.some(e=>e.kind==='model_retry'));
  await runtime.stop();runtime=null;const restored=new TokenLedger({pool});assert.deepEqual((await restored.entries(scope)).find(e=>e.kind==='unknown').evidence.diagnostic,expected);
  await assert.rejects(model.next({billingContext:{taskId:task.id,turn:2}}),{code:'USAGE_RECONCILIATION_REQUIRED'});assert.equal(calls,1);assert.equal((await restored.balance(scope)).reserved,'20');
 }finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
