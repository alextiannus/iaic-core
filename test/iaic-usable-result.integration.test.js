import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {TokenLedger,meteredModel,AgentRuntime,TaskStore,ContextAssembler,CapabilityDispatcher,defineCapability,UsageReconciler} from '@immedi/iaic-core';
const price={revision:'fixture',input:1,cachedInput:1,output:1};
async function fixture(run){
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;assert.ok(connectionString);
 const schema='usable_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new Pool({connectionString,options:`-c search_path=${schema}`});const runtimes=[];
 try{const ledger=new TokenLedger({pool});await ledger.initialize();const scope={applicationId:'app',subjectId:'user'},actor={scopeId:'app',subjectId:'user'};
 await ledger.grant(scope,{reference:'fixture',amount:100,evidence:{fixture:true}});
 const make=async(provider,{policy={},tools=[],verify=()=>true,maxTurns=20}={})=>{
 const model=meteredModel({model:provider,ledger,scope,policy:{maximum:20,price,pendingUsage:'continue',...policy}});
 const agent=defineCapability({name:'work',description:'Fixture task',input:{type:'object'},output:{type:'object'},effect:'read',authorize:()=>true,implementation:{kind:'agent',instructions:'Finish verified work',tools:tools.map(t=>t.name),verify}});
 const store=new TaskStore({pool}),dispatcher=new CapabilityDispatcher({capabilities:[agent,...tools]});const runtime=new AgentRuntime({store,dispatcher,model,context:new ContextAssembler({}),version:'fixture',maxTurns});dispatcher.tasks=runtime;await runtime.initialize();runtimes.push(runtime);return {runtime,store,agent,model};};
 await run({pool,ledger,scope,actor,make});
 }finally{for(const r of runtimes)await r.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
test('usable result completes while usage stays pending; worker closes billing independently',()=>fixture(async({ledger,scope,actor,make})=>{
 let calls=0;const f=await make({name:'fixture',next:async()=>{calls++;return {type:'finish',result:{done:true},usageEvidence:{providerReference:'provider-1'}};}},{maxTurns:1});
 const task=await f.runtime.create({actor,capability:f.agent,input:{},idempotencyKey:'one'});assert.equal((await f.runtime.tick()).status,'succeeded');assert.equal(calls,1);
 const [work]=await ledger.reconciliationWork(scope);assert.equal(work.resultAvailable,true);assert.equal(work.providerReference,'provider-1');assert.equal(work.attribution.taskId,task.id);assert.equal(work.attribution.turn,1);assert.equal((await ledger.balance(scope)).reserved,'20');assert.equal((await ledger.taskUsage(scope,task.id)).complete,false);
 const reconciler=new UsageReconciler({ledger,authorize:()=>true,resolveSource:async sourceId=>({sourceId,confirmed:true,scope,requestId:work.requestId,outcome:'measured',providerReference:'provider-1',usage:{input_tokens:2,output_tokens:1},failed:false,evidence:{fixture:true}})});
 const receipt=await reconciler.reconcile({}, {sourceId:'export-1'});assert.deepEqual(await reconciler.reconcile({}, {sourceId:'export-1'}),receipt);
 assert.equal((await ledger.balance(scope)).reserved,'0');assert.equal((await ledger.balance(scope)).balance,'97');assert.deepEqual(await ledger.reconciliationWork(scope),[]);assert.equal((await f.store.get(actor,task.id)).status,'succeeded');assert.equal(calls,1);
}));
test('durable call executes once; next model turn continues with original holds',()=>fixture(async({ledger,scope,actor,make})=>{
 let calls=0,actions=0;const tool=defineCapability({name:'read',description:'Read fixture',revalidate:(_input,result)=>result,input:{type:'object'},output:{type:'object'},effect:'read',authorize:()=>true,implementation:{kind:'function',execute:async()=>{actions++;return {ok:true};}}});
 const f=await make({name:'fixture',next:async()=>++calls===1?{type:'call',name:'read',input:{}}:{type:'finish',result:{done:true}}},{tools:[tool]});
 await f.runtime.create({actor,capability:f.agent,input:{},idempotencyKey:'tool'});const result=await f.runtime.tick();assert.equal(result.status,'succeeded',JSON.stringify(result));assert.equal(actions,1);assert.equal(calls,2);assert.equal((await ledger.balance(scope)).reserved,'40');
}));
test('restart after durable ledger commit but before Runtime checkpoint reuses original response',()=>fixture(async({ledger,scope,actor,make})=>{
 let calls=0;const provider={name:'fixture',next:async()=>{calls++;return {type:'finish',result:{done:true}};}};
 const f=await make(provider);const task=await f.runtime.create({actor,capability:f.agent,input:{},idempotencyKey:'crash'});
 const append=f.runtime.executor.append.bind(f.runtime.executor);let crash=true;f.runtime.executor.append=async(id,kind,data)=>{if(kind==='metered_result'&&crash){crash=false;throw Error('injected checkpoint failure');}return append(id,kind,data);};
 assert.equal((await f.runtime.tick()).status,'waiting');assert.equal(calls,1);await f.runtime.stop();
 const g=await make(provider);await g.runtime.transition(actor,task.id,{action:'resume'});assert.equal((await g.runtime.tick()).status,'succeeded');assert.equal(calls,1);assert.equal((await ledger.balance(scope)).reserved,'20');
}));
test('no result, invalid action and explicit blocking policy cannot continue or retry',async()=>{
 for(const kind of ['timeout','invalid','block'])await fixture(async({ledger,scope,actor,make})=>{
 let calls=0;const f=await make({name:'fixture',next:async()=>{calls++;if(kind==='timeout')throw Error('private-provider-error');return kind==='invalid'?{text:'not an action'}:{type:'finish',result:{done:true}};}},{policy:kind==='block'?{pendingUsage:'block'}:{}});
 const task=await f.runtime.create({actor,capability:f.agent,input:{},idempotencyKey:kind});assert.equal((await f.runtime.tick()).waiting_reason,'usage_reconciliation');await f.runtime.transition(actor,task.id,{action:'resume'});assert.equal((await f.runtime.tick()).waiting_reason,'usage_reconciliation');assert.equal(calls,1);assert.equal((await ledger.reconciliationWork(scope))[0].resultAvailable,false);assert.equal((await ledger.balance(scope)).reserved,'20');
 });
});
test('unknown holds bound further continuation and result reads stay within payer/model binding',()=>fixture(async({ledger,scope,make})=>{
 let calls=0;const f=await make({name:'fixture',next:async()=>{calls++;return {type:'finish',result:{done:true}};}});const receipts=[];
 for(let turn=1;turn<=5;turn++){const response=await f.model.next({billingContext:{taskId:'direct',turn,resultReceipts:receipts}});receipts.push(response.billing.requestId);}
 await assert.rejects(f.model.next({billingContext:{taskId:'direct',turn:6,resultReceipts:receipts}}),{code:'TOKEN_BALANCE_INSUFFICIENT'});assert.equal(calls,5);assert.equal((await ledger.balance(scope)).reserved,'100');
 assert.equal(await ledger.recoverResult({...scope,subjectId:'other'},{taskId:'direct',model:'fixture'}),null);
 await assert.rejects(ledger.recoverResult(scope,{taskId:'direct',model:'wrong'}),{statusCode:409});
 const first=await ledger.reconciliationWork(scope,{limit:2}),second=await ledger.reconciliationWork(scope,{after:first[1].requestId,limit:2});assert.equal(new Set([...first,...second].map(r=>r.requestId)).size,4);
}));
test('restart after tool settlement does not execute the action again',()=>fixture(async({actor,make})=>{
 let calls=0,actions=0;const tool=defineCapability({name:'read',description:'Read fixture',revalidate:(_i,r)=>r,input:{type:'object'},output:{type:'object'},effect:'read',authorize:()=>true,implementation:{kind:'function',execute:async()=>{actions++;return {ok:true};}}});
 const provider={name:'fixture',next:async()=>++calls===1?{type:'call',name:'read',input:{}}:{type:'finish',result:{done:true}}};
 const f=await make(provider,{tools:[tool]});const task=await f.runtime.create({actor,capability:f.agent,input:{},idempotencyKey:'crash-tool'});
 const settle=f.runtime.executor.settle.bind(f.runtime.executor);f.runtime.executor.settle=async(...args)=>{await settle(...args);throw Error('crash after committed tool receipt');};
 assert.equal((await f.runtime.tick()).status,'waiting');assert.equal(actions,1);await f.runtime.stop();
 const g=await make(provider,{tools:[tool]});await g.runtime.transition(actor,task.id,{action:'resume'});assert.equal((await g.runtime.tick()).status,'succeeded');assert.equal(actions,1);assert.equal(calls,2);
}));
test('wait consumption is atomic with Task outcome and resumes without repeating question',()=>fixture(async({actor,make})=>{
 let calls=0;const f=await make({name:'fixture',next:async()=>++calls===1?{type:'wait',question:'Please provide details'}:{type:'finish',result:{done:true}}});
 const task=await f.runtime.create({actor,capability:f.agent,input:{},idempotencyKey:'wait'});assert.equal((await f.runtime.tick()).waiting_reason,'input');
 await f.runtime.transition(actor,task.id,{action:'provide_input',input:'Details supplied'});assert.equal((await f.runtime.tick()).status,'succeeded');assert.equal(calls,2);
}));
test('retained tool still checks current authorization after restart',()=>fixture(async({actor,make})=>{
 let allowed=true,actions=0,calls=0;const tool=defineCapability({name:'read',description:'Read fixture',revalidate:(_i,r)=>r,input:{type:'object'},output:{type:'object'},effect:'read',authorize:()=>allowed,implementation:{kind:'function',execute:async()=>{actions++;return {};}}});
 const provider={name:'fixture',next:async()=>{calls++;return {type:'call',name:'read',input:{}};}};
 const f=await make(provider,{tools:[tool],maxTurns:1});const task=await f.runtime.create({actor,capability:f.agent,input:{},idempotencyKey:'revoked'});
 const append=f.runtime.executor.append.bind(f.runtime.executor);f.runtime.executor.append=async(id,kind,data)=>{await append(id,kind,data);if(kind==='metered_result')throw Error('interrupt after checkpoint');};
 assert.equal((await f.runtime.tick()).status,'waiting');await f.runtime.stop();allowed=false;
 const g=await make(provider,{tools:[tool],maxTurns:1});await g.runtime.transition(actor,task.id,{action:'resume'});assert.equal((await g.runtime.tick()).status,'waiting');assert.equal(actions,0);assert.equal(calls,1);
}));
test('settlement outage or lost acknowledgement preserves result without recharging',async()=>{
 for(const committed of [false,true])await fixture(async({ledger,scope,actor,make})=>{
 let calls=0;const settle=ledger.settle.bind(ledger);ledger.settle=async(...args)=>{if(committed)await settle(...args);throw Error('injected settlement outage');};
 const f=await make({name:'fixture',next:async()=>{calls++;return {type:'finish',result:{done:true},usage:{inputTokens:2,outputTokens:1},usageEvidence:{providerReference:'known-1'}};}});
 const task=await f.runtime.create({actor,capability:f.agent,input:{},idempotencyKey:'settlement'});assert.equal((await f.runtime.tick()).status,'succeeded');assert.equal(calls,1);
 assert.equal((await ledger.balance(scope)).reserved,committed?'0':'20');assert.equal((await ledger.balance(scope)).balance,committed?'97':'100');assert.equal((await ledger.reconciliationWork(scope)).length,committed?0:1);
 const history=await f.store.history(actor,task.id);assert.equal(history.events.find(e=>e.kind==='metered_result').data.billing.usageState,committed?'confirmed':'pending');
 });
});
test('retained result cannot be released as a provider non-acceptance',()=>fixture(async({ledger,scope,make})=>{
 const f=await make({name:'fixture',next:async()=>({type:'finish',result:{done:true}})});const response=await f.model.next({billingContext:{taskId:'source',turn:1,resultReceipts:[]}});
 await assert.rejects(ledger.reconcile(scope,{sourceId:'contradiction',requestId:response.billing.requestId,outcome:'not_accepted',providerReference:'not-accepted',evidence:{fixture:true}}),{statusCode:409});assert.equal((await ledger.balance(scope)).reserved,'20');
}));
