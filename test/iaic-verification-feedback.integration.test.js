import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {AgentRuntime,TaskStore,ContextAssembler,CapabilityDispatcher,defineCapability} from '@immedi/iaic-core';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
test('application rejection feedback survives waiting and Runtime reconstruction before verified completion',{skip:!url},async()=>{
 const admin=new Pool({connectionString:url}),schema='verification_feedback_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});let runtime;
 try{
 const actor={subjectId:'owner',scopeId:'fixture'};let checked=0;
 const cap=defineCapability({name:'agent.verify',description:'Verify a fixture value',input:{type:'object'},output:{type:'object',properties:{value:{type:'integer'}},required:['value'],additionalProperties:false},effect:'read',authorize:()=>true,implementation:{kind:'agent',instructions:'Use application feedback to correct the result',tools:[],verify:async(_input,result)=>{checked++;return result.value===42?{verified:true}:{verified:false,feedback:'The authoritative fixture value is 42; correct the proposed value.'};}}});
 const open=async()=>{const dispatcher=new CapabilityDispatcher({capabilities:[cap]});const rt=new AgentRuntime({store:new TaskStore({pool}),dispatcher,context:new ContextAssembler({}),version:'feedback-v1',model:{name:'fixture',next:async({messages})=>{
  const data=JSON.parse(messages[1].content),verifications=data.events.filter(e=>e.kind==='verification'),rejected=verifications.at(-1);
  if(!rejected)return {type:'finish',result:{value:'invalid-schema'}};
  if(verifications.length===1){assert.match(rejected.data.feedback,/output schema/);return {type:'finish',result:{value:41}};}
  assert.match(rejected.data.feedback,/authoritative fixture value is 42/);
  if(!data.events.some(e=>e.kind==='input'))return {type:'wait',question:'Confirm correction'};
  return {type:'finish',result:{value:42}};
 }}});dispatcher.tasks=rt;await rt.initialize();return rt;};
 runtime=await open();const task=await runtime.create({actor,capability:cap,input:{goal:'Verify fixture'},idempotencyKey:'original'});assert.equal((await runtime.tick()).waiting_reason,'input');assert.equal(checked,1);await runtime.stop();runtime=await open();await runtime.transition(actor,task.id,{action:'provide_input',input:'Confirmed',requestKey:'clarification'});assert.equal((await runtime.tick()).status,'succeeded');assert.equal(checked,2);
 const history=await runtime.store.history(actor,task.id);assert.deepEqual(history.events.filter(e=>e.kind==='verification').map(e=>e.data.verified),[false,false,true]);assert.equal((await runtime.get(actor,task.id)).result.value,42);
 }finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});

test('preflight correction feedback survives Runtime reconstruction with one eventual write',{skip:!url},async()=>{
 const admin=new Pool({connectionString:url}),schema='preflight_feedback_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});let runtime,writes=0;
 try{
 const actor={subjectId:'owner',scopeId:'fixture'};
 const save=defineCapability({name:'record.save',description:'Save using the current domain revision',input:{type:'object',properties:{revision:{type:'integer'}},required:['revision'],additionalProperties:false},output:{type:'object'},effect:'write',retry:'never-replay',authorize:a=>a.subjectId==='owner',preflight:input=>input.revision===1?{valid:true}:{valid:false,feedback:'/revision must be 1, the current authorized domain revision.'},revalidate:async(_input,result)=>result,implementation:{kind:'function',execute:async()=>{writes++;return {saved:true};}}});
 const cap=defineCapability({name:'agent.correct',description:'Correct a rejected domain input',input:{type:'object'},output:{type:'object'},effect:'read',authorize:()=>true,implementation:{kind:'agent',instructions:'Use preflight feedback and preserve successful writes',tools:['record.save'],verify:async(_input,result,{history})=>result.done===true&&history.calls.some(c=>c.capability==='record.save'&&c.status==='succeeded')}});
 const open=async()=>{const dispatcher=new CapabilityDispatcher({capabilities:[save,cap]});const rt=new AgentRuntime({store:new TaskStore({pool}),dispatcher,context:new ContextAssembler({}),version:'preflight-fixture-v1',model:{name:'fixture',next:async({messages})=>{
  const data=JSON.parse(messages[1].content),feedback=data.events.find(e=>e.kind==='feedback');
  if(data.calls.some(c=>c.status==='succeeded'))return {type:'finish',result:{done:true}};
  if(!feedback)return {type:'call',name:'record.save',input:{revision:0}};
  assert.equal(feedback.data.feedback,'/revision must be 1, the current authorized domain revision.');
  if(!data.events.some(e=>e.kind==='input'))return {type:'wait',question:'Fixture reconstruction checkpoint'};
  return {type:'call',name:'record.save',input:{revision:1}};
 }}});dispatcher.tasks=rt;await rt.initialize();return rt;};
 runtime=await open();const task=await runtime.create({actor,capability:cap,input:{goal:'Save revision'},idempotencyKey:'original'});assert.equal((await runtime.tick()).waiting_reason,'input');assert.equal(writes,0);await runtime.stop();runtime=await open();await runtime.transition(actor,task.id,{action:'provide_input',input:'Continue original task',requestKey:'continue'});assert.equal((await runtime.tick()).status,'succeeded');assert.equal(writes,1);
 const history=await runtime.store.history(actor,task.id);assert.deepEqual(history.calls.map(c=>c.status),['failed','succeeded']);assert.equal(history.events.filter(e=>e.kind==='feedback'&&e.data.capability==='record.save').length,1);assert.equal(history.calls.some(c=>c.status==='unknown'),false);
 }finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
