import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {AgentRuntime,TaskStore,ContextAssembler,CapabilityDispatcher,defineCapability} from '@immedi/iaic-core';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
test('Runtime communicates durable remaining budgets and tightens batches before final completion',{skip:!url},async()=>{
 const admin=new Pool({connectionString:url}),schema='budget_context_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});let runtime;
 try{
 const actor={subjectId:'owner',scopeId:'fixture'};let executions=0;const observed=[];
 const read=defineCapability({name:'source.read',description:'Read fixture',input:{type:'object'},output:{type:'object'},effect:'read',authorize:()=>true,revalidate:async()=>({value:42}),implementation:{kind:'function',execute:async()=>{executions++;return {value:42};}}});
 const cap=defineCapability({name:'agent.budget',description:'Verify fixture',input:{type:'object'},output:{type:'object'},effect:'read',authorize:()=>true,implementation:{kind:'agent',instructions:'Read, clarify and finish',tools:['source.read'],verify:async(_input,result)=>result.value===42}});
 const open=async()=>{const dispatcher=new CapabilityDispatcher({capabilities:[read,cap]});const rt=new AgentRuntime({store:new TaskStore({pool}),dispatcher,context:new ContextAssembler({}),version:'budget-v1',maxTurns:5,maxCalls:2,maxBatchCalls:4,model:{name:'fixture',next:async request=>{
  const data=JSON.parse(request.messages[1].content);const budget=JSON.parse(request.messages.find(m=>m.content.startsWith('{"executionBudget":')).content.split('\n')[0]).executionBudget;
  observed.push(budget);assert.equal(request.maxBatchCalls,budget.completionOnly?1:budget.maxBatchCalls);
  assert.ok(!request.messages.some(m=>m.content.includes('batch of up to 4')));
  if(!data.calls.length)return {type:'call',name:'source.read',input:{}};
  if(!data.events.some(e=>e.kind==='input'))return {type:'wait',question:'Confirm fresh read'};
  if(data.calls.length===1)return {type:'call',name:'source.read',input:{}};
  assert.equal(request.tools.length,0);return {type:'finish',result:{value:42}};
 }}});dispatcher.tasks=rt;await rt.initialize();return rt;};
 runtime=await open();const task=await runtime.create({actor,capability:cap,input:{goal:'Read and verify'},idempotencyKey:'original'});assert.equal((await runtime.tick()).waiting_reason,'input');await runtime.stop();runtime=await open();await runtime.transition(actor,task.id,{action:'provide_input',input:'Confirm another read',requestKey:'confirm'});assert.equal((await runtime.tick()).status,'succeeded');assert.equal(executions,2);
 assert.deepEqual(observed,[{remainingToolCalls:2,remainingModelTurns:5,maxBatchCalls:2,completionOnly:false},{remainingToolCalls:1,remainingModelTurns:4,maxBatchCalls:1,completionOnly:false},{remainingToolCalls:1,remainingModelTurns:3,maxBatchCalls:1,completionOnly:false},{remainingToolCalls:0,remainingModelTurns:2,maxBatchCalls:0,completionOnly:true}]);
 }finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
