import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {AgentRuntime,TaskStore,ContextAssembler,CapabilityDispatcher,defineCapability} from '@immedi/iaic-core';

const url=process.env.SUBMISSION_TEST_DATABASE_URL;
for(const outcome of ['returned','unknown','rejected'])test(`Per-tool ceiling survives ${outcome} batch attempt and Runtime reconstruction`,{skip:!url},async()=>{
 const admin=new Pool({connectionString:url}),schema='tool_limits_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});let runtime;
 try{
  await pool.query('CREATE TABLE effects(id text PRIMARY KEY)');
  const actor={subjectId:'owner',scopeId:'fixture'};let denied=false;
  const write=defineCapability({name:'record.write',description:'Write fixture',input:{type:'object'},output:{type:'object'},effect:'write',retry:'never-replay',authorize:()=>!denied,
   preflight:()=>outcome!=='rejected',revalidate:async(_i,r)=>r,implementation:{kind:'function',execute:async(_i,c)=>{
    await pool.query('INSERT INTO effects VALUES($1)',[c.callId]);if(outcome==='unknown')throw new Error('Lost original acknowledgement');return {done:true};
   }}});
  const policy={'record.write':1};
  const cap=defineCapability({name:'agent.limited',description:'One write',input:{type:'object'},output:{type:'object'},effect:'read',authorize:()=>!denied,
   implementation:{kind:'agent',instructions:'Make at most one write',tools:[write.name],toolCallLimits:policy,verify:async()=>Number((await pool.query('SELECT count(*) FROM effects')).rows[0].count)===(outcome==='rejected'?0:1)}});
  policy['record.write']=100;assert.equal(cap.implementation.toolCallLimits['record.write'],1);assert.ok(Object.isFrozen(cap.implementation.toolCallLimits));
  const open=async()=>{
   const dispatcher=new CapabilityDispatcher({capabilities:[write,cap]});
   const rt=new AgentRuntime({store:new TaskStore({pool}),dispatcher,context:new ContextAssembler({}),version:'tool-limits-v1',maxBatchCalls:2,maxTurns:6,model:{name:'fixture',next:async request=>{
    const context=JSON.parse(request.messages[1].content);
    const budget=JSON.parse(request.messages.find(m=>m.content.startsWith('{"remainingToolAttempts":')).content.split('\n')[0]).remainingToolAttempts;
    if(!context.calls.length){assert.equal(budget['record.write'],1);return {type:'batch',actions:[1,2].map(()=>({type:'call',name:write.name,input:{}}))};}
    assert.equal(budget['record.write'],0);assert.equal(request.tools.length,0);
    if(!context.events.some(e=>e.kind==='input'))return {type:'wait',question:'Continue without another write?'};
    // Deliberately ignore discovery once: server admission must enforce the ceiling too.
    if(!context.events.some(e=>e.kind==='feedback'&&e.data.capability===write.name&&e.data.error.startsWith('Tool attempt limit')))return {type:'call',name:write.name,input:{}};
    return {type:'finish',result:{done:true}};
   }}});dispatcher.tasks=rt;await rt.initialize();return rt;
  };
  runtime=await open();const task=await runtime.create({actor,capability:cap,input:{goal:'One attempt',toolCallLimits:{'record.write':99}},idempotencyKey:'original'});
  const first=await runtime.tick();assert.equal(first.waiting_reason,outcome==='unknown'?'external_result':'input');
  await runtime.stop();runtime=await open();
  let history=await runtime.store.history(actor,task.id);assert.equal(history.calls.length,1);
  if(outcome==='unknown'){
   assert.equal(history.calls[0].status,'unknown');await assert.rejects(runtime.transition(actor,task.id,{action:'resume'}));
   await runtime.store.resolveCall(actor,task.id,history.calls[0].id,{done:true});await runtime.transition(actor,task.id,{action:'resume'});
   assert.equal((await runtime.tick()).waiting_reason,'input');
  }
  denied=true;await assert.rejects(runtime.transition(actor,task.id,{action:'provide_input',input:'Continue'}),{statusCode:403});denied=false;
  await runtime.transition(actor,task.id,{action:'provide_input',input:'Continue',requestKey:'confirm'});
  assert.equal((await runtime.tick()).status,'succeeded');
  history=await runtime.store.history(actor,task.id);assert.equal(history.calls.length,1);
  assert.equal((await pool.query('SELECT * FROM effects')).rowCount,outcome==='rejected'?0:1);
  assert.ok(history.events.some(e=>e.kind==='feedback'&&e.data.error?.startsWith('Tool attempt limit')));
 }finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});

test('Host tool ceilings reject invalid policy and permit explicit zero',()=>{
 const base={name:'agent.limited',description:'Fixture',input:{type:'object'},output:{type:'object'},effect:'read',authorize:()=>true,implementation:{kind:'agent',instructions:'Fixture',tools:['record.write'],verify:()=>true}};
 for(const toolCallLimits of [null,[],{'missing.tool':1},{'record.write':-1},{'record.write':1.5},{'record.write':Infinity}])assert.throws(()=>defineCapability({...base,implementation:{...base.implementation,toolCallLimits}}),/Tool call limits/);
 assert.equal(defineCapability({...base,implementation:{...base.implementation,toolCallLimits:{'record.write':0}}}).implementation.toolCallLimits['record.write'],0);
});
