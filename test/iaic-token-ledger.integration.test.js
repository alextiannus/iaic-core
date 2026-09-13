import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {TokenLedger} from '@immedi/iaic-core/billing/token-ledger.js';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
test('Token ledger survives restart, serializes concurrent calls and settles actual usage exactly once',{skip:!url},async()=>{
 const admin=new Pool({connectionString:url}),schema='billing_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
 try{
  const ledger=new TokenLedger({pool});await ledger.initialize();
  const scope={applicationId:'app',subjectId:'user'},price={revision:'price-1',input:2,cachedInput:1,output:3};
  const args={mode:'SYSTEM_MANAGED',maximum:80,price,attribution:{assistant:'assistant',task:'task',model:'model'}};
  await Promise.all(Array.from({length:5},()=>ledger.grant(scope,{reference:'payment-1',amount:100,evidence:{kind:'test-adapter',reference:'payment-1'}})));
  assert.equal((await ledger.balance(scope)).available,'100');
  await assert.rejects(ledger.grant(scope,{reference:'payment-1',amount:101,evidence:{kind:'test-adapter',reference:'payment-1'}}),{statusCode:409});
  const calls=await Promise.allSettled(['a','b'].map(requestId=>ledger.reserve(scope,{...args,requestId})));
  assert.equal(calls.filter(r=>r.status==='fulfilled').length,1);assert.equal(calls.find(r=>r.status==='rejected').reason.code,'TOKEN_BALANCE_INSUFFICIENT');
  const call=calls.find(r=>r.status==='fulfilled').value;
  assert.equal((await ledger.reserve(scope,{...args,requestId:call.request_id})).replayed,true);
  await assert.rejects(ledger.reserve(scope,{...args,maximum:79,requestId:call.request_id}),{statusCode:409});
  const usage={input_tokens:10,output_tokens:5,input_tokens_details:{cached_tokens:4},output_tokens_details:{reasoning_tokens:2}};
  await Promise.all(Array.from({length:5},()=>ledger.settle(scope,{requestId:call.request_id,usage,providerReference:'provider-call-1'})));
  // 6*2 + 4*1 + 5*3 = 31; reasoning already included in output.
  const restarted=new TokenLedger({pool});assert.deepEqual(await restarted.balance(scope),{balance:'69',reserved:'0',available:'69',unit:'credit_minor'});
  assert.equal((await ledger.entries(scope)).filter(r=>r.kind==='settlement').length,1);
  const page=await ledger.entries(scope,{limit:1});const next=await ledger.entries(scope,{limit:1,before:page[0].id});assert.equal(next[0].kind,'grant');assert.ok(BigInt(next[0].id)<BigInt(page[0].id));await assert.rejects(ledger.entries(scope,{before:'invalid'}),{statusCode:400});
  await assert.rejects(ledger.settle(scope,{requestId:call.request_id,usage:{...usage,output_tokens:6},providerReference:'provider-call-1'}),{statusCode:409});
  for(const field of ['applicationId','subjectId']){
   assert.equal((await ledger.balance({...scope,[field]:'other'})).balance,'0');
   await assert.rejects(ledger.settle({...scope,[field]:'other'},{requestId:call.request_id,usage,providerReference:'provider-call-1'}),{statusCode:404});
  }
  await ledger.reserve(scope,{...args,requestId:'unknown',maximum:60});
  await ledger.markUnknown(scope,{requestId:'unknown',evidence:{reason:'transport_timeout'}});
  assert.equal((await restarted.balance(scope)).available,'9');assert.equal((await ledger.pending(scope))[0].state,'unknown');assert.deepEqual(await ledger.pending({...scope,subjectId:'other'}),[]);
  await assert.rejects(ledger.release(scope,{requestId:'unknown',evidence:{providerAccepted:false,reference:'unsupported-assumption'}}),{statusCode:409});
  await assert.rejects(ledger.reserve(scope,{...args,requestId:'blocked',maximum:10}),{statusCode:402});
  await restarted.settle(scope,{requestId:'unknown',usage:{input_tokens:5,output_tokens:0},providerReference:'reconciled-provider-call',failed:true});
  assert.equal((await ledger.balance(scope)).available,'59');
  await ledger.reserve(scope,{...args,requestId:'byok',mode:'BYOK',maximum:0});
  await ledger.settle(scope,{requestId:'byok',usage,providerReference:'own-model'});
  assert.equal((await ledger.balance(scope)).available,'59');
  const own=(await ledger.entries(scope)).find(r=>r.reference==='byok');assert.equal(own.delta,'0');assert.equal(own.evidence.ratedCredits,'31');
  await ledger.reserve(scope,{...args,requestId:'not-sent',maximum:50});
  await ledger.release(scope,{requestId:'not-sent',evidence:{providerAccepted:false,reference:'local-preflight'}});
  assert.equal((await ledger.balance(scope)).available,'59');
  await assert.rejects(ledger.settle(scope,{requestId:'not-sent',usage,providerReference:'impossible'}),{statusCode:409});
  await ledger.reserve(scope,{...args,requestId:'overrun',maximum:59});
  const debt=await ledger.settle(scope,{requestId:'overrun',usage:{input_tokens:50,output_tokens:0},providerReference:'overrun-evidence'});
  assert.equal(debt.available,'-41');assert.equal(debt.receipt.evidence.reservationExceeded,true);
  await assert.rejects(ledger.reserve(scope,{...args,requestId:'debt-blocked',maximum:1}),{statusCode:402});
  await assert.rejects(ledger.grant(scope,{reference:'unsafe',amount:Number.MAX_SAFE_INTEGER+1,evidence:{kind:'test'}}),{statusCode:400});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});

test('real runtime pauses before provider on empty allowance, then resumes same task after a grant',{skip:!url},async()=>{
 const {meteredModel}=await import('@immedi/iaic-core/billing/metered-model.js');
 const {TaskStore}=await import('@immedi/iaic-core/tasks/store.js');
 const {AgentRuntime}=await import('@immedi/iaic-core/agent/runtime.js');
 const {defineCapability,CapabilityDispatcher}=await import('@immedi/iaic-core/capabilities/index.js');
 const {ContextAssembler}=await import('@immedi/iaic-core/context/index.js');
 const admin=new Pool({connectionString:url}),schema='metered_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});let runtime;
 try{
  const ledger=new TokenLedger({pool});await ledger.initialize();const scope={applicationId:'app',subjectId:'user'};
  const store=new TaskStore({pool}),actor={scopeId:'E1',subjectId:'user@test'};let calls=0,unknown=false;
  const provider={name:'fixture-model',next:async()=>{calls++;return {type:'finish',result:{done:true},usage:unknown?null:{inputTokens:3,outputTokens:2},usageEvidence:{rawUsage:{prompt_tokens:3,completion_tokens:2},providerReference:'provider-'+calls}};}};
  const model=meteredModel({model:provider,ledger,scope,policy:{maximum:20,price:{revision:'test-platform-rule',input:2,cachedInput:1,output:3}}});
  const agent=defineCapability({name:'assistant.work',description:'Complete task',input:{type:'object'},output:{type:'object'},effect:'read',authorize:async()=>true,implementation:{kind:'agent',instructions:'Complete the task',tools:[],verify:async()=>true}});
  const dispatcher=new CapabilityDispatcher({capabilities:[agent]});runtime=new AgentRuntime({store,dispatcher,model,context:new ContextAssembler({skillRoot:'/private/tmp'}),version:'v1'});dispatcher.tasks=runtime;await runtime.initialize();
  const task=await runtime.create({capability:agent,input:{goal:'finish'},actor,idempotencyKey:'first'});
  assert.equal((await runtime.tick()).waiting_reason,'token_balance');assert.equal(calls,0);
  await ledger.grant(scope,{reference:'platform-grant',amount:30,evidence:{kind:'test-only-platform-allocation'}});
  await runtime.transition(actor,task.id,{action:'resume'});
  assert.equal((await runtime.tick()).status,'succeeded');assert.equal(calls,1);
  assert.equal((await ledger.balance(scope)).available,'18');
  const entry=(await ledger.entries(scope)).find(e=>e.kind==='settlement');assert.equal(entry.evidence.ratedCredits,'12');assert.equal(entry.evidence.usage.rawProviderUsage.prompt_tokens,3);
  // Missing usage must pause instead of consuming a free model retry.
  await ledger.grant(scope,{reference:'second-grant',amount:30,evidence:{kind:'test-only-platform-allocation'}});unknown=true;
  const second=await runtime.create({capability:agent,input:{goal:'unknown'},actor,idempotencyKey:'second'});
  assert.equal((await runtime.tick()).waiting_reason,'usage_reconciliation');assert.equal(calls,2);assert.equal((await ledger.balance(scope)).reserved,'20');
  await runtime.transition(actor,second.id,{action:'resume'});assert.equal((await runtime.tick()).waiting_reason,'usage_reconciliation');assert.equal(calls,2);
 }finally{if(runtime)await runtime.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
