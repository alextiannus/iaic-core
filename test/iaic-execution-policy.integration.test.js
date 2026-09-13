import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {ExecutionPolicy,CapabilityDispatcher,defineCapability,AgentRuntime,TaskStore,ContextAssembler,createCapabilityHttpHandler} from '@immedi/iaic-core';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
test('Current policy blocks a returning Agent action, retains durable decisions, and applies to HTTP execution',{skip:!url},async()=>{
 const admin=new Pool({connectionString:url}),schema='execution_policy_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});let runtime;
 try{
  await pool.query('CREATE TABLE policy_records(id uuid PRIMARY KEY,record jsonb NOT NULL)');await pool.query('CREATE TABLE effects(id text PRIMARY KEY)');
  const actor={subjectId:'owner',scopeId:'policy-example'};let enabled=true,revision='r1',modelCalls=0;
  const policy=new ExecutionPolicy({decide:()=>({allowed:enabled,revision,reason:enabled?'enabled':'kill switch active'}),record:async record=>{const id=randomUUID();await pool.query('INSERT INTO policy_records VALUES($1,$2)',[id,record]);return {id};}});
  const write=defineCapability({name:'record.write',description:'Create fixture record',input:{type:'object'},output:{type:'object'},effect:'write',retry:'never-replay',authorize:()=>true,revalidate:(_i,r)=>r,implementation:{kind:'function',execute:async(_i,c)=>{await pool.query('INSERT INTO effects VALUES($1)',[c.callId]);return {id:c.callId};}}});
  const agent=defineCapability({name:'agent.work',description:'Create one record',input:{type:'object'},output:{type:'object'},effect:'read',authorize:()=>true,implementation:{kind:'agent',instructions:'Write once and finish',tools:[write.name],verify:async()=>Number((await pool.query('SELECT count(*) FROM effects')).rows[0].count)===1}});
  const dispatcher=new CapabilityDispatcher({capabilities:[write,agent],executionPolicy:policy});
  const open=async()=>{runtime=new AgentRuntime({store:new TaskStore({pool}),dispatcher,version:'policy-v1',context:new ContextAssembler({}),model:{name:'fixture',next:async({messages})=>{modelCalls++;const data=JSON.parse(messages.find(m=>m.role==='user').content);if(modelCalls===1){enabled=false;revision='r2';}return data.calls.length?{type:'finish',result:{done:true}}:{type:'call',name:write.name,input:{}};}}});dispatcher.tasks=runtime;await runtime.initialize();};
  await open();const task=await runtime.create({actor,capability:agent,input:{goal:'Write once'},idempotencyKey:'original'});
  assert.equal((await runtime.tick()).waiting_reason,'interrupted');assert.equal((await runtime.store.history(actor,task.id)).calls.length,0);assert.equal((await pool.query('SELECT * FROM effects')).rowCount,0);
  // An execution stop does not erase history or replace its current read permissions.
  assert.equal((await runtime.get(actor,task.id)).status,'waiting');await runtime.stop();await open();
  enabled=true;revision='r3';await runtime.transition(actor,task.id,{action:'resume'});assert.equal((await runtime.tick()).status,'succeeded');assert.equal(modelCalls,3);
  enabled=false;revision='r4';const handler=createCapabilityHttpHandler({dispatcher,resolveAccess:()=>({actor,capabilities:[write.name]})});
  const response=await handler(new Request('http://fixture/capabilities/record.write',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input:{},requestKey:'blocked-http'})}));assert.equal(response.status,403);assert.equal((await response.json()).error.outcomeUnknown,false);assert.equal((await pool.query('SELECT * FROM effects')).rowCount,1);
  const rows=(await pool.query('SELECT record FROM policy_records')).rows.map(r=>r.record);assert.ok(rows.some(r=>r.taskId===task.id&&r.phase==='agent'&&r.decision.revision==='r2'&&!r.decision.allowed));assert.ok(rows.some(r=>r.phase==='function'&&r.callId==='blocked-http'&&!r.decision.allowed));assert.ok(rows.some(r=>r.phase==='admission'&&r.callId==='original'));assert.ok(rows.every(r=>!Object.hasOwn(r,'input')));
 }finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
