import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {TaskStore} from '@immedi/iaic-core/tasks/store.js';
import {defineCapability,CapabilityDispatcher} from '@immedi/iaic-core/capabilities/index.js';
import {AgentRuntime} from '@immedi/iaic-core/agent/runtime.js';
import {createModelProvider} from '@immedi/iaic-core/agent/model-provider.js';
import {ContextAssembler} from '@immedi/iaic-core/context/index.js';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
test('IAiC model-loop controls with deterministic model and real persistence',{skip:!url},async t=>{
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname));
 const admin=new Pool({connectionString:url});const schema=`runtime_test_${randomUUID().replaceAll('-','')}`;
 await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
 const store=new TaskStore({pool});const actor={scopeId:'E1',subjectId:'u@example.test'};let runtime;
 const schemaObject={type:'object',additionalProperties:true};
 const setup=async({actions,write=false,execute=async()=>({source:'S1'}),verify=async(_input,result)=>result.report==='evidenced',authorizeTool=async()=>true,authorizeAgent=async()=>true,preflight,taskInput={goal:'Prepare'},...limits})=>{
  if(runtime)await reset();
  const capability=defineCapability({name:'records.read',description:'Read accessible evidence',input:schemaObject,output:schemaObject,effect:write?'write':'read',retry:'never-replay',authorize:authorizeTool,preflight,
   revalidate:async(_input,result)=>result,implementation:{kind:'function',execute}});
  const agent=defineCapability({name:'reports.prepare',description:'Prepare an evidence-based report',input:schemaObject,output:schemaObject,effect:'read',authorize:authorizeAgent,
   implementation:{kind:'agent',instructions:'Read evidence, then prepare report.',tools:['records.read'],verify}});
  const dispatcher=new CapabilityDispatcher({capabilities:[capability,agent]});let step=0;
  const model={name:'deterministic-control-fixture',next:async request=>{const next=actions[step++];return typeof next==='function'?next(request):next;}};
  runtime=new AgentRuntime({store,dispatcher,model,context:new ContextAssembler({skillRoot:'/private/tmp'}),version:'v1',...limits});dispatcher.tasks=runtime;await runtime.initialize();
  const task=await dispatcher.invoke('reports.prepare',taskInput,{actor,callId:randomUUID()});return task;
 };
 const reset=async()=>{if(runtime)await runtime.stop();runtime=null;await pool.query('TRUNCATE iaic_tasks CASCADE');};
 try{
  await t.test('last permitted tool call can be followed by verified completion without more tools',async()=>{
   let calls=0;
   const task=await setup({maxCalls:1,maxTurns:2,execute:async()=>{calls++;return {source:'S1'};},actions:[{type:'call',name:'records.read',input:{}},request=>{
    assert.deepEqual(request.tools,[]);assert.equal(request.delegationSchema,null);assert.match(JSON.stringify(request.messages),/S1/);
    return {type:'finish',result:{report:'evidenced'}};
   }]});
   assert.equal((await runtime.tick()).status,'succeeded');assert.equal(calls,1);
   const history=await store.history(actor,task.id);assert.equal(history.calls.length,1);
   assert.equal(history.events.filter(e=>e.kind==='model_requested'&&e.data.completionOnly).length,1);await reset();
  });
  await t.test('completion opportunity never executes another call or delegation and never bypasses verification',async()=>{
   for(const action of [{type:'call',name:'records.read',input:{}},{type:'delegate',input:{}},{type:'finish',result:{report:'unsupported'}}]){
    let calls=0;
    const task=await setup({maxCalls:1,maxTurns:8,execute:async()=>{calls++;return {};},actions:[{type:'call',name:'records.read',input:{}},action,()=>{throw Error('Unexpected additional model request');}]});
    assert.equal((await runtime.tick()).waiting_reason,'limit');assert.equal(calls,1);
    const history=await store.history(actor,task.id);assert.equal(history.events.filter(e=>e.kind==='model_requested').length,2);await reset();
   }
  });
  await t.test('completion opportunity cannot exceed the model turn budget',async()=>{
   const task=await setup({maxCalls:1,maxTurns:1,actions:[{type:'call',name:'records.read',input:{}},()=>{throw Error('Budget exceeded');}]});
   assert.equal((await runtime.tick()).waiting_reason,'limit');
   assert.equal((await store.history(actor,task.id)).events.filter(e=>e.kind==='model_requested').length,1);await reset();
  });
  await t.test('explicit task tools narrow discovery and reject out-of-scope model calls without a Mandate',async()=>{
   let calls=0;
   const task=await setup({taskInput:{goal:'Prepare without tools',allowedTools:[]},execute:async()=>{calls++;return {};},actions:[request=>{assert.deepEqual(request.tools,[]);return {type:'call',name:'records.read',input:{}};},request=>{assert.deepEqual(request.tools,[]);return {type:'finish',result:{report:'evidenced'}};}]});
   assert.equal((await runtime.tick()).status,'succeeded');assert.equal(calls,0);
   const history=await store.history(actor,task.id);assert.equal(history.calls.length,0);assert.ok(history.events.some(e=>e.kind==='feedback'&&e.data.error.includes('outside this task scope')));await reset();
  });
  await t.test('task tool subsets survive persistence and invalid scopes never create Tasks',async()=>{
   const task=await setup({taskInput:{goal:'Prepare',allowedTools:['records.read']},actions:[request=>{assert.deepEqual(request.tools.map(t=>t.name),['records.read']);return {type:'call',name:'records.read',input:{}};},{type:'finish',result:{report:'evidenced'}}]});
   assert.deepEqual((await store.get(actor,task.id)).input.allowedTools,['records.read']);
   for(const allowedTools of ['records.read',['missing'],['records.read','records.read'],[null]])await assert.rejects(runtime.dispatcher.invoke('reports.prepare',{goal:'Invalid',allowedTools},{actor,callId:randomUUID()}),{statusCode:400});
   assert.equal((await store.list(actor)).length,1);assert.equal((await runtime.tick()).status,'succeeded');await reset();
  });
  await t.test('explicit model switch retains successful tool calls and requires current task identity',async()=>{
   let writes=0,step=0,newCalls=0;
   const models={a:{name:'a',next:async()=>step++===0?{type:'call',name:'records.read',input:{}}:{type:'wait',question:'Continue?'}},b:{name:'b',next:async request=>{newCalls++;assert.match(JSON.stringify(request.messages),/S1/);return {type:'finish',result:{report:'evidenced'}};}}};
   const task=await setup({actions:[],write:true,execute:async()=>{writes++;return {source:'S1'};},resolveModel:async({modelIdentity})=>models[modelIdentity||'a']});
   await assert.rejects(store.switchModel(actor,task.id,{model:'b',expectedModel:'a',version:'v1'}),{statusCode:409});
   assert.equal((await runtime.tick()).waiting_reason,'input');assert.equal(writes,1);
   await assert.rejects(store.switchModel(actor,task.id,{model:'b',expectedModel:'stale',version:'v1'}),{statusCode:409});
   await store.switchModel(actor,task.id,{model:'b',expectedModel:'a',version:'v1'});
   assert.equal((await store.get(actor,task.id)).waiting_reason,'input');
   await runtime.transition(actor,task.id,{action:'provide_input',input:'Yes'});
   assert.equal((await runtime.tick()).status,'succeeded');assert.equal(writes,1);assert.equal(newCalls,1);
   const history=await store.history(actor,task.id);assert.deepEqual(history.events.find(e=>e.kind==='model_changed').data,{from:'a',to:'b'});await reset();
  });
  await t.test('model chooses operations and final output must pass application verifier',async()=>{
   let calls=0;
   const task=await setup({actions:[{type:'call',name:'records.read',input:{}},{type:'finish',result:{report:'unsupported'}},{type:'finish',result:{report:'evidenced'}}],execute:async()=>{calls++;return {source:'S1'};}});
   const result=await runtime.tick();assert.equal(result.status,'succeeded');assert.equal(calls,1);
   const history=await store.history(actor,task.id);assert.deepEqual(history.events.filter(e=>e.kind==='verification').map(e=>e.data.verified),[false,true]);
   assert.equal(history.calls[0].status,'succeeded');await reset();
  });
  await t.test('preflight rejection permits correction without an unknown write',async()=>{
   let writes=0;
   const task=await setup({write:true,preflight:async input=>input.correct===true,execute:async()=>{writes++;return {};},actions:[{type:'call',name:'records.read',input:{correct:false}},{type:'call',name:'records.read',input:{correct:true}},{type:'finish',result:{report:'evidenced'}}]});
   assert.equal((await runtime.tick()).status,'succeeded');assert.equal(writes,1);
   const history=await store.history(actor,task.id);assert.deepEqual(history.calls.map(c=>c.status),['failed','succeeded']);assert.ok(history.events.some(e=>e.kind==='feedback'&&e.data.error.includes('preflight')));await reset();
  });
  await t.test('post-write error becomes unknown and stops further model actions',async()=>{
   let writes=0;
   const task=await setup({write:true,actions:[{type:'call',name:'records.read',input:{}}],execute:async()=>{writes++;throw new Error('Actual commit, lost response fixture');}});
   const result=await runtime.tick();assert.equal(result.waiting_reason,'external_result');assert.equal(writes,1);
   assert.equal((await store.history(actor,task.id)).calls[0].status,'unknown');
   await assert.rejects(runtime.transition(actor,task.id,{action:'resume'}),/uncertain/);await reset();
  });
  await t.test('cancellation while model is responding prevents tool dispatch',async()=>{
   let calls=0,task;
   task=await setup({actions:[async()=>{await store.transition(actor,task.id,{action:'cancel'});return {type:'call',name:'records.read',input:{},usage:{inputTokens:7,outputTokens:3}};}],execute:async()=>{calls++;return {};}});
   assert.equal((await runtime.tick()).status,'cancelled');assert.equal(calls,0);assert.equal((await store.history(actor,task.id)).calls.length,0);
   assert.equal((await store.history(actor,task.id)).events.find(event=>event.kind==='model_usage').data.usage.inputTokens,7);await reset();
  });
  await t.test('wait for input and resume preserve successful call without repeating it',async()=>{
   let calls=0;
   const task=await setup({actions:[{type:'call',name:'records.read',input:{}},{type:'wait',question:'Which comparison?'},{type:'finish',result:{report:'evidenced'}}],execute:async()=>{calls++;return {source:'S1'};}});
   assert.equal((await runtime.tick()).waiting_reason,'input');
   await runtime.transition(actor,task.id,{action:'provide_input',input:'Compare severity'});
   assert.equal((await runtime.tick()).status,'succeeded');assert.equal(calls,1);await reset();
  });
  await t.test('unverified finish cannot escape model-turn budget',async()=>{
   await setup({actions:[{type:'finish',result:{report:'unverified'}}],maxTurns:1});
   assert.equal((await runtime.tick()).waiting_reason,'limit');await reset();
  });
  await t.test('task deadline aborts a real-provider-style pending model request',async()=>{
   await setup({taskTimeoutMs:10,modelTimeoutMs:1000,actions:[request=>new Promise((resolve,reject)=>{
    if(request.signal.aborted)reject(request.signal.reason);
    else request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true});
   })]});
   assert.equal((await runtime.tick()).waiting_reason,'limit');await reset();
  });
  await t.test('late model completion cannot succeed after the task deadline',async()=>{
   await setup({taskTimeoutMs:500,actions:[async()=>{
    await new Promise(resolve=>setTimeout(resolve,600));
    return {type:'finish',result:{report:'evidenced'},usage:{inputTokens:7}};
   }]});
   const result=await runtime.tick();assert.equal(result.status,'waiting');assert.equal(result.waiting_reason,'limit');
   const history=await store.history(actor,result.id);
   assert.equal(history.events.find(event=>event.kind==='model_usage').data.usage.inputTokens,7);
   assert.equal(history.events.some(event=>event.kind==='verification'&&event.data.verified),false);await reset();
  });
  await t.test('verification returning after the deadline cannot certify success',async()=>{
   await setup({taskTimeoutMs:500,actions:[{type:'finish',result:{report:'evidenced'}}],verify:async()=>{
    await new Promise(resolve=>setTimeout(resolve,600));return true;
   }});
   const result=await runtime.tick();assert.equal(result.status,'waiting');assert.equal(result.waiting_reason,'limit');await reset();
  });
  await t.test('deadline during tool authorization prevents a new write',async()=>{
   let writes=0;
   await setup({taskTimeoutMs:500,write:true,actions:[{type:'call',name:'records.read',input:{}}],authorizeTool:async()=>{
    await new Promise(resolve=>setTimeout(resolve,600));return true;
   },execute:async()=>{writes++;return {};}});
   const result=await runtime.tick();assert.equal(writes,0);assert.equal(result.waiting_reason,'limit');
   assert.equal((await store.history(actor,result.id)).calls[0].status,'failed');await reset();
  });
  await t.test('chat text completion receives feedback before structured wait under the same task and budget',async()=>{
   let requests=0;
   const provider=createModelProvider({apiKey:'fixture',model:'fixture',provider:'chat-completions',baseUrl:'https://provider.example/v1',fetchImpl:async(_url,options)=>{
    const sent=JSON.parse(options.body);requests++;
    if(requests===2)assert.match(JSON.stringify(sent.messages),/iaic_wait/);
    return new Response(JSON.stringify({choices:[{finish_reason:requests===1?'stop':'tool_calls',message:requests===1?{content:'Which subject?'}:{tool_calls:[{type:'function',function:{name:'iaic_wait',arguments:JSON.stringify({question:'Which subject?'})}}]}}],usage:{prompt_tokens:7,completion_tokens:3,total_tokens:10}}));
   }});
   const invoke=request=>provider.next(request);
   const task=await setup({actions:[invoke,invoke]});
   assert.equal((await runtime.tick()).waiting_reason,'input');assert.equal(requests,2);
   const history=await store.history(actor,task.id);assert.equal(history.calls.length,0);
   assert.equal(history.events.filter(e=>e.kind==='model_usage').length,2);
   assert.equal(history.events.filter(e=>e.kind==='feedback'&&e.data.error?.includes('received 0')).length,1);await reset();
   requests=0;await setup({maxTurns:1,actions:[invoke]});
   assert.equal((await runtime.tick()).waiting_reason,'invalid_model_action');assert.equal(requests,1);await reset();
  });
  await t.test('invalid wire actions receive feedback within the original model budget',async()=>{
   const task=await setup({actions:[()=>{throw Object.assign(new Error('Use a declared function name'),{invalidAction:true,usage:{inputTokens:2,outputTokens:1}});},{type:'finish',result:{report:'evidenced'}}]});
   assert.equal((await runtime.tick()).status,'succeeded');const history=await store.history(actor,task.id);
   assert.equal(history.calls.length,0);assert.equal(history.events.filter(e=>e.kind==='model_requested').length,2);
   assert.ok(history.events.some(e=>e.kind==='feedback'&&e.data.error.includes('declared')));await reset();
   await setup({maxTurns:1,actions:[()=>{throw Object.assign(new Error('Invalid action'),{invalidAction:true});}]});
   assert.equal((await runtime.tick()).waiting_reason,'invalid_model_action');await reset();
  });
  await t.test('invalid tool input feeds back schema paths without executing a write',async()=>{
   let writes=0;
   const task=await setup({write:true,actions:[{type:'call',name:'records.read',input:{}},{type:'finish',result:{report:'evidenced'}}],execute:async()=>{writes++;return {};}});
   const capability=runtime.dispatcher.capabilities.get('records.read');
   runtime.dispatcher.capabilities.set('records.read',defineCapability({...capability,input:{type:'object',properties:{content:{type:'object'}},required:['content'],additionalProperties:false}}));
   assert.equal((await runtime.tick()).status,'succeeded');assert.equal(writes,0);
   const history=await store.history(actor,task.id);assert.equal(history.calls[0].status,'failed');
   assert.ok(history.events.some(e=>e.kind==='feedback'&&e.data.validation?.[0].keyword==='required'));await reset();
  });
  await t.test('model timeout waits explicitly instead of claiming completion',async()=>{
   await setup({actions:[()=>new Promise(()=>{})],modelTimeoutMs:10});
   assert.equal((await runtime.tick()).waiting_reason,'model_timeout');await reset();
  });
  await t.test('deadline classification survives providers replacing the abort error and preserves usage',async()=>{
   for(const limits of [{modelTimeoutMs:100,taskTimeoutMs:2000},{modelTimeoutMs:2000,taskTimeoutMs:100}]){
    let aborted=false;
    const task=await setup({...limits,actions:[]});
    runtime.model.next=request=>new Promise((resolve,reject)=>{
     const abort=()=>{aborted=true;reject(Object.assign(new Error('Provider transport aborted'),{usage:{inputTokens:7},providerStatus:429}));};
     if(request.signal.aborted)abort();else request.signal.addEventListener('abort',abort,{once:true});
    });
    const result=await runtime.tick();assert.equal(result.status,'waiting');assert.equal(result.waiting_reason,limits.modelTimeoutMs<limits.taskTimeoutMs?'model_timeout':'limit');assert.equal(aborted,true);
    const history=await store.history(actor,task.id);
    assert.equal(history.events.find(e=>e.kind==='model_usage').data.usage.inputTokens,7);
    assert.equal(history.events.filter(e=>e.kind==='model_requested').length,1);
    assert.equal(history.events.some(e=>e.kind==='model_retry'),false);await reset();
   }
  });
  await t.test('ordinary provider failures are classified without inventing known usage',async()=>{
   const task=await setup({actions:[()=>{throw new Error('Connection closed');}]});
   assert.equal((await runtime.tick()).waiting_reason,'provider_error');
   assert.equal((await store.history(actor,task.id)).events.find(e=>e.kind==='model_usage').data.usage,null);await reset();
  });
  await t.test('a provider returning completion during abort cannot bypass the model deadline',async()=>{
   const task=await setup({actions:[],modelTimeoutMs:100,taskTimeoutMs:2000});
   runtime.model.next=request=>new Promise(resolve=>request.signal.addEventListener('abort',()=>resolve({type:'finish',result:{report:'evidenced'},usage:{inputTokens:7}}),{once:true}));
   assert.equal((await runtime.tick()).waiting_reason,'model_timeout');
   const history=await store.history(actor,task.id);
   assert.equal(history.events.find(e=>e.kind==='model_usage').data.usage.inputTokens,7);
   assert.equal(history.events.some(e=>e.kind==='verification'),false);await reset();
  });
  await t.test('one rate-limit retry retains failed usage and never replays a completed write',async()=>{
   let writes=0;
   const task=await setup({write:true,rateLimitDelayMs:5,execute:async()=>{writes++;return {};},actions:[
    {type:'call',name:'records.read',input:{}},()=>{throw Object.assign(new Error('rate limited'),{providerStatus:429});},
    {type:'finish',result:{report:'evidenced'}}]});
   assert.equal((await runtime.tick()).status,'succeeded');assert.equal(writes,1);
   const history=await store.history(actor,task.id);
   assert.equal(history.events.filter(e=>e.kind==='model_retry').length,1);
   assert.equal(history.events.filter(e=>e.kind==='model_usage'&&e.data.failed).length,1);
   assert.equal(history.calls.length,1);await reset();
  });
  await t.test('repeated rate limits and excessive Retry-After stop without extra requests',async()=>{
   for(const retryAfterMs of [0,120000]){
    let requests=0;const limited=()=>{requests++;throw Object.assign(new Error('rate limited'),{providerStatus:429,retryAfterMs});};
    await setup({rateLimitDelayMs:1,actions:[limited,limited,()=>{throw Error('unexpected retry');}]});
    assert.equal((await runtime.tick()).status,'waiting');assert.equal(requests,retryAfterMs?1:2);await reset();
   }
  });
  await t.test('cancellation during rate-limit backoff prevents another model request',async()=>{
   let requests=0;let task;let cancellation=Promise.resolve();
   task=await setup({rateLimitDelayMs:30,actions:[()=>{requests++;cancellation=new Promise(resolve=>setTimeout(resolve,5)).then(()=>runtime.transition(actor,task.id,{action:'cancel'}));cancellation.catch(()=>{});throw Object.assign(new Error('rate limited'),{providerStatus:429});},()=>{requests++;return {type:'finish',result:{report:'evidenced'}};}]});
   // The tick may observe the persisted cancellation before transition finishes
   // its final Task read. Join that operation before deleting fixture rows.
   let outcome;try{outcome=await runtime.tick();}finally{await cancellation;}
   assert.equal(outcome.status,'cancelled');assert.equal(requests,1);await reset();
  });
  await t.test('rate-limit backoff stays inside the original task deadline',async()=>{
   // Leave CI enough time to claim/read the Task before entering the backoff being tested.
   let requests=0;const task=await setup({rateLimitDelayMs:10000,taskTimeoutMs:2000,actions:[()=>{requests++;throw Object.assign(new Error('rate limited'),{providerStatus:429});}]});
   const started=Date.now();assert.equal((await runtime.tick()).waiting_reason,'limit');assert.equal(requests,1);
   assert.ok(Date.now()-started<8000,'The original deadline must interrupt the longer backoff');
   assert.ok((await store.history(actor,task.id)).events.some(event=>event.kind==='model_retry'),'The test must actually enter rate-limit backoff');await reset();
  });
  await t.test('authorization is checked again before retrying a rate-limited model request',async()=>{
   let permitted=true,requests=0;
   await setup({rateLimitDelayMs:1,authorizeAgent:async()=>permitted,actions:[()=>{requests++;permitted=false;throw Object.assign(new Error('rate limited'),{providerStatus:429});}]});
   assert.equal((await runtime.tick()).status,'waiting');assert.equal(requests,1);await reset();
  });
 }finally{if(runtime)await runtime.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
