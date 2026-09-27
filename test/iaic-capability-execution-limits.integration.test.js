import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {AgentRuntime,TaskStore,ContextAssembler,CapabilityDispatcher,defineCapability} from '@immedi/iaic-core';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
test('host-selected capability budget survives reconstruction while other Agents retain defaults',{skip:!url},async()=>{
 const admin=new Pool({connectionString:url}),schema='cap_limits_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});let runtime;
 const actor={subjectId:'owner',scopeId:'limits'},observed=[];
 const read=defineCapability({name:'source.read',description:'Read fixture',input:{type:'object'},output:{type:'object'},effect:'read',authorize:()=>true,revalidate:async()=>({value:1}),implementation:{kind:'function',execute:async()=>({value:1})}});
 const agent=name=>defineCapability({name,description:'Complete bounded work',input:{type:'object'},output:{type:'object'},effect:'read',authorize:()=>true,implementation:{kind:'agent',instructions:'Read requested records',tools:['source.read'],verify:async(input,_result,{history})=>history.calls.length===input.count}});
 const big=agent('agent.large'),normal=agent('agent.normal');
 const open=async()=>{const dispatcher=new CapabilityDispatcher({capabilities:[read,big,normal]});const rt=new AgentRuntime({store:new TaskStore({pool}),dispatcher,context:new ContextAssembler({}),version:'cap-limits-v1',maxTurns:4,maxCalls:2,capabilityLimits:{'agent.large':{maxTurns:40,maxCalls:36}},model:{name:'fixture',next:async request=>{
  const data=JSON.parse(request.messages[1].content),budget=JSON.parse(request.messages.find(m=>m.content.startsWith('{"executionBudget":')).content.split('\n')[0]).executionBudget;observed.push({count:data.calls.length,...budget});
  if(data.calls.length===20&&!data.events.some(e=>e.kind==='input'))return {type:'wait',question:'Continue original work'};
  if(data.calls.length>=data.goal.count)return {type:'finish',result:{done:true}};
  if(!request.tools.length)return {type:'wait',question:'Original budget exhausted'};
  return {type:'call',name:'source.read',input:{}};
 }}});dispatcher.tasks=rt;await rt.initialize();return rt;};
 try{
  runtime=await open();const task=await runtime.create({actor,capability:big,input:{count:35},idempotencyKey:'large'});assert.equal((await runtime.tick()).waiting_reason,'input');await runtime.stop();runtime=await open();await runtime.transition(actor,task.id,{action:'provide_input',input:'Continue',requestKey:'continue'});assert.equal((await runtime.tick()).status,'succeeded');
  assert.equal((await runtime.store.history(actor,task.id)).calls.length,35);assert.ok(observed.some(v=>v.count===20&&v.remainingToolCalls===16));
  const ordinary=await runtime.create({actor,capability:normal,input:{count:35,maxCalls:1000,capabilityLimits:{'agent.normal':{maxCalls:1000}}},idempotencyKey:'normal'});const stopped=await runtime.tick();assert.equal(stopped.status,'waiting');assert.equal((await runtime.store.history(actor,ordinary.id)).calls.length,2);assert.equal(observed.at(-3).remainingToolCalls,2);assert.equal(observed.at(-3).remainingModelTurns,4);
 }finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
