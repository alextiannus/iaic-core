import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {TaskStore,AgentRuntime,CapabilityDispatcher,defineCapability,ContextAssembler} from '@immedi/iaic-core';
const admin=new Pool({connectionString:process.env.DATABASE_URL}),schema='example_wait_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});let runtime,ready=false,turns=0;
try {
 const store=new TaskStore({pool}),actor={scopeId:'sample',subjectId:'owner'},object={type:'object'};
 const execute=async()=>({ready});
 const receipt=defineCapability({name:'receipt.await',description:'Wait for external receipt',input:object,output:{type:'object',properties:{ready:{type:'boolean'}},required:['ready']},effect:'read',authorize:async()=>true,implementation:{kind:'function',execute},revalidate:execute,waitReady:(_i,r)=>r.ready});
 const agent=defineCapability({name:'work.run',description:'Wait then finish',input:object,output:object,effect:'read',authorize:async()=>true,implementation:{kind:'agent',tools:[receipt.name],instructions:'Wait for receipt',verify:async()=>ready}});
 const dispatcher=new CapabilityDispatcher({capabilities:[receipt,agent]}),model={name:'fixture',next:async()=>++turns===1?{type:'call',name:receipt.name,input:{}}:{type:'finish',result:{done:true}}};
 const create=()=>new AgentRuntime({store,dispatcher,model,version:'example-v1',context:new ContextAssembler({})});
 runtime=create();await runtime.initialize();const task=await runtime.create({actor,capability:agent,input:{},idempotencyKey:'one'});assert.equal((await runtime.tick()).waiting_reason,'external_result');
 await runtime.stop();runtime=create();await runtime.initialize();runtime.resultWaits.intervalMs=0;
 assert.equal(await runtime.tick(),null);assert.equal(turns,1);ready=true;assert.equal((await runtime.tick()).status,'succeeded');assert.equal(turns,2);
 const history=await store.history(actor,task.id);assert.equal(history.calls.length,1);assert.equal(history.events.filter(e=>e.kind==='result_ready').length,1);
 console.log(JSON.stringify({status:'passed',taskId:task.id,runtimeReplacement:true,modelCalls:turns,waitingModelCalls:0,recordedReads:history.calls.length}));
}finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
