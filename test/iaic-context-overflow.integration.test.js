import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {AgentRuntime,TaskStore,ContextAssembler,CapabilityDispatcher,defineCapability} from '@immedi/iaic-core';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
test('persistent Agent continues after history overflow and service reconstruction without redoing tools',{skip:!url},async()=>{
 const schema='context_overflow_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:url});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});let runtime;
 try{
 const actor={scopeId:'fixture',subjectId:'owner'};let reads=0;
 const caps=['large','small'].map(name=>defineCapability({name:'source.'+name,description:name,input:{type:'object'},output:{type:'object'},effect:'read',authorize:()=>true,implementation:{kind:'function',execute:async()=>{reads++;return {body:name==='large'?'x'.repeat(8000):'verified'};}},revalidate:async(_input,result)=>result}));
 const cap=defineCapability({name:'agent.demo',description:'Persist context',input:{type:'object'},output:{type:'object'},effect:'read',authorize:()=>true,implementation:{kind:'agent',instructions:'Read sources, ask and finish',tools:caps.map(c=>c.name),verify:async(_i,result)=>result.value==='verified'}});caps.push(cap);
 let turn=0;
 const open=async()=>{const dispatcher=new CapabilityDispatcher({capabilities:caps});const rt=new AgentRuntime({store:new TaskStore({pool}),dispatcher,version:'fixture',maxBatchCalls:2,context:new ContextAssembler({maxBytes:6000,overflow:'omit-old-results'}),model:{name:'fixture',next:async({messages})=>{
  const data=JSON.parse(messages[1].content);turn++;
  if(turn===1)return {type:'batch',actions:[{type:'call',name:'source.large',input:{}},{type:'call',name:'source.small',input:{}}]};
  assert.equal(data.calls.find(c=>c.capability==='source.large').resultOmitted,true);assert.equal(data.calls.find(c=>c.capability==='source.small').result.body,'verified');
  if(turn===2)return {type:'wait',question:'Confirm completion'};
  assert.ok(data.events.some(e=>e.kind==='input'));return {type:'finish',result:{value:'verified'}};
 }}});dispatcher.tasks=rt;await rt.initialize();return rt;};
 runtime=await open();const task=await runtime.create({actor,capability:cap,input:{goal:'Read and verify'},idempotencyKey:'fixture'});
 assert.equal((await runtime.tick()).status,'waiting');await runtime.stop();runtime=await open();
 await runtime.transition(actor,task.id,{action:'provide_input',input:'Confirmed',requestKey:'confirm'});
 assert.equal((await runtime.tick()).status,'succeeded');assert.equal(reads,2);
 const history=await runtime.store.history(actor,task.id);assert.equal(history.calls.find(c=>c.capability==='source.large').result.body.length,8000);assert.equal(history.calls.length,2);
 }finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
