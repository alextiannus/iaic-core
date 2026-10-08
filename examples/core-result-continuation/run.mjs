import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
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
await fixture(async({ledger,scope,actor,make})=>{
 let calls=0;const f=await make({name:'fixture',next:async()=>{calls++;return {type:'finish',result:{done:true},usageEvidence:{providerReference:'provider-1'}};}},{maxTurns:1});
 const task=await f.runtime.create({actor,capability:f.agent,input:{},idempotencyKey:'one'});assert.equal((await f.runtime.tick()).status,'succeeded');assert.equal(calls,1);
 const [work]=await ledger.reconciliationWork(scope);assert.equal(work.resultAvailable,true);assert.equal(work.providerReference,'provider-1');assert.equal(work.attribution.taskId,task.id);assert.equal(work.attribution.turn,1);assert.equal((await ledger.balance(scope)).reserved,'20');assert.equal((await ledger.taskUsage(scope,task.id)).complete,false);
 const reconciler=new UsageReconciler({ledger,authorize:()=>true,resolveSource:async sourceId=>({sourceId,confirmed:true,scope,requestId:work.requestId,outcome:'measured',providerReference:'provider-1',usage:{input_tokens:2,output_tokens:1},failed:false,evidence:{fixture:true}})});
 const receipt=await reconciler.reconcile({}, {sourceId:'export-1'});assert.deepEqual(await reconciler.reconcile({}, {sourceId:'export-1'}),receipt);
 assert.equal((await ledger.balance(scope)).reserved,'0');assert.equal((await ledger.balance(scope)).balance,'97');assert.deepEqual(await ledger.reconciliationWork(scope),[]);assert.equal((await f.store.get(actor,task.id)).status,'succeeded');assert.equal(calls,1);
});
console.log(JSON.stringify({status:"passed",businessTaskCompleted:true,independentUsageReconciliation:true,realProvider:false}));
