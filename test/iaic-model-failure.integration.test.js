import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {TaskStore} from '../tasks/store.js';
import {AgentRuntime} from '../agent/runtime.js';
import {createModelProvider} from '../agent/model-provider.js';
import {OpenAIProvider} from '../agent/openai-provider.js';
import {ContextAssembler} from '../context/index.js';
import {defineCapability,CapabilityDispatcher} from '../capabilities/index.js';
import {TokenLedger} from '../billing/token-ledger.js';
import {meteredModel} from '../billing/metered-model.js';
import {createTaskControlCapabilities} from '../tasks/controls.js';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
test('measured truncation survives restart, blocks repeated resume and preserves original writes',{skip:!url},async()=>{
 const admin=new Pool({connectionString:url}),schema='model_failure_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
 let runtime;
 try{
  const ledger=new TokenLedger({pool});await ledger.initialize();const scope={applicationId:'test',subjectId:'user'},actor={scopeId:'test',subjectId:'user'};
  await ledger.grant(scope,{reference:'test',amount:100000,evidence:{kind:'fixture'}});
  let requests=0,writes=0;
  const provider=createModelProvider({apiKey:'fixture',model:'fixture',provider:'chat-completions',baseUrl:'https://fixture.invalid',fetchImpl:async()=>{
   requests++;return new Response(JSON.stringify({id:'response-'+requests,choices:[{finish_reason:requests===1?'tool_calls':'length',message:{reasoning_content:'SECRET REASONING',tool_calls:[{type:'function',function:{name:'records_write',arguments:'{}'}}]}}],usage:{prompt_tokens:7,completion_tokens:4096,total_tokens:4103,completion_tokens_details:{reasoning_tokens:4096}}}));
  }});
  const model=meteredModel({model:provider,ledger,scope,policy:{maximum:20000,price:{revision:'test',input:1,output:1,cachedInput:1}}});
  const shape={type:'object'},authorize=async()=>true;
  const agent=defineCapability({name:'agent.work',description:'Test',input:shape,output:shape,effect:'read',authorize,implementation:{kind:'agent',instructions:'Test',tools:['records.write'],verify:async()=>false}});
  const write=defineCapability({name:'records.write',description:'Test write',input:shape,output:shape,effect:'write',retry:'never-replay',authorize,revalidate:async(_i,r)=>r,implementation:{kind:'function',execute:async()=>({receipt:++writes})}});
  const store=new TaskStore({pool}),dispatcher=new CapabilityDispatcher({capabilities:[agent,write]});
  const open=async()=>{runtime=new AgentRuntime({store,dispatcher,model,context:new ContextAssembler({skillRoot:'/tmp'}),version:'v1'});dispatcher.tasks=runtime;await runtime.initialize();};
  await open();const task=await dispatcher.invoke('agent.work',{}, {actor,callId:'truncate'});
  const result=await runtime.tick();assert.equal(result.waiting_reason,'model_output_limit');assert.equal(result.error,'MODEL_OUTPUT_LIMIT');assert.equal(writes,1);assert.equal(requests,2);
  assert.equal((await ledger.balance(scope)).reserved,'0');assert.equal((await ledger.entries(scope)).filter(e=>e.kind==='settlement').length,2);
  const history=await store.history(actor,task.id);assert.equal(history.calls.length,1);assert.equal(history.calls[0].status,'succeeded');assert.equal(history.events.filter(e=>e.kind==='model_usage'&&e.data.failed).length,1);
  assert.ok(!JSON.stringify(history).includes('SECRET REASONING'));
  await runtime.stop();await open(); // re-initialize SQL constraints with new persisted reason
  const controls=new CapabilityDispatcher({capabilities:createTaskControlCapabilities({runtime,authorize})});
  assert.deepEqual((await controls.invoke('tasks.state',{id:task.id},{actor})).diagnostic,{code:'MODEL_OUTPUT_LIMIT',nextAction:'review_profile_and_create_task'});
  for(let i=0;i<2;i++)await assert.rejects(runtime.transition(actor,task.id,{action:'resume',requestKey:'resume-'+i}),{code:'MODEL_RESTART_REQUIRED',statusCode:409});
  await assert.rejects(store.transition(actor,task.id,{action:'provide_input',input:'retry',version:'v1'}),{code:'MODEL_RESTART_REQUIRED'});
  assert.equal(await runtime.tick(),null);assert.equal(writes,1);assert.equal(requests,2);
  await runtime.transition(actor,task.id,{action:'cancel'});assert.equal((await store.get(actor,task.id)).status,'cancelled');
  // Same length signal WITHOUT measured usage remains unknown, not a fabricated settlement.
  const unknown=createModelProvider({apiKey:'fixture',model:'unknown',provider:'chat-completions',baseUrl:'https://fixture.invalid',fetchImpl:async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{}}]}))});
  const metered=meteredModel({model:unknown,ledger,scope,policy:{maximum:20000,price:{revision:'test',input:1,output:1,cachedInput:1}}});
  runtime.model=metered;const pending=await dispatcher.invoke('agent.work',{}, {actor,callId:'unknown'});
  assert.equal((await runtime.tick()).waiting_reason,'usage_reconciliation');assert.equal((await ledger.pending(scope)).length,1);
  await runtime.transition(actor,pending.id,{action:'resume'});assert.equal((await runtime.tick()).waiting_reason,'usage_reconciliation');
  assert.equal((await ledger.entries(scope)).filter(e=>e.kind==='settlement').length,2);
 }finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
test('Responses max_output_tokens uses same stable truncation code and retains usage',async()=>{
 const provider=new OpenAIProvider({apiKey:'fixture',model:'fixture',fetchImpl:async()=>new Response(JSON.stringify({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},usage:{input_tokens:3,output_tokens:4,total_tokens:7}}))});
 await assert.rejects(provider.next({messages:[],tools:[],outputSchema:{type:'object'}}),e=>e.code==='MODEL_OUTPUT_LIMIT'&&e.usage.totalTokens===7);
});
