import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {AssistantModelRouting,TokenLedger,TaskStore,AgentRuntime,ContextAssembler,CapabilityDispatcher,defineCapability} from '@immedi/iaic-core';
import {AssistantModels} from '@immedi/iaic-core/assistants/models.js';
import {ModelProfiles} from '@immedi/iaic-core/agent/model-profiles.js';
import {createModelProvider} from '@immedi/iaic-core/agent/model-provider.js';
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL;
if(!connectionString)throw new Error('Isolated PostgreSQL required');
const schema='route_example_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});
await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let runtime;
try {
 const actor={scopeId:'routing',subjectId:'owner'},scope={applicationId:'routing',subjectId:'owner'};
 const ledger=new TokenLedger({pool});await ledger.initialize();await ledger.grant(scope,{reference:'fixture',amount:'100',evidence:{fixture:true}});
 let primaryAvailable=false;const calls=[];
 const makeRouter=()=>new AssistantModelRouting({models:new AssistantModels({
  settings:{get:async()=>({model_profile:'primary'})},resolveScope:async()=>scope,ledger,
  profiles:{list:()=>['primary','backup'].map(id=>({id,model:id,modelIdentity:id+':v1'})),resolve:async id=>({name:id+':v1',model:id,profileId:id,next:async()=>{calls.push(id);return {type:'finish',result:{selected:id},usage:{inputTokens:2,outputTokens:1}};}})},
  tokenPolicies:Object.fromEntries(['primary','backup'].map(id=>[id,{maximum:'10',price:{revision:'fixture',input:'1',cachedInput:'1',output:'1'}}]))
 }),resolvePolicy:async()=>({revision:'route-v1',profileIds:['primary','backup']}),availability:async({profile})=>profile.id==='primary'&&!primaryAvailable?'unavailable':'available'});
 const cap=defineCapability({name:'route.demo',description:'Verify persisted actual model routing',input:{type:'object'},output:{type:'object'},effect:'read',authorize:a=>a.subjectId==='owner',implementation:{kind:'agent',instructions:'Return the selected fixture model',tools:[],verify:async(_i,r)=>['primary','backup'].includes(r.selected)}});
 const makeRuntime=()=>{const router=makeRouter(),store=new TaskStore({pool}),dispatcher=new CapabilityDispatcher({capabilities:[cap]});const rt=new AgentRuntime({store,dispatcher,model:{name:'primary:v1'},resolveModel:request=>router.resolve(request),context:new ContextAssembler({skillRoot:'/tmp'}),version:'routing-fixture-v1'});dispatcher.tasks=rt;return rt;};
 runtime=makeRuntime();await runtime.initialize();
 const task=await runtime.create({actor,capability:cap,input:{goal:'Use the configured route'},idempotencyKey:'original'});
 assert.equal(task.model,'backup:v1');await runtime.stop();primaryAvailable=true;
 runtime=makeRuntime();await runtime.initialize();assert.equal((await runtime.tick()).status,'succeeded');
 assert.deepEqual(calls,['backup']);assert.equal(await ledger.hasPendingTask(scope,task.id),false);
 const fresh=await runtime.create({actor,capability:cap,input:{goal:'Use the current route'},idempotencyKey:'fresh'});
 assert.equal(fresh.model,'primary:v1');assert.equal((await runtime.tick()).status,'succeeded');assert.deepEqual(calls,['backup','primary']);
 await ledger.grant(scope,{reference:'output-budget-fixture',amount:'10000',evidence:{fixture:true}});
 let boundedCalls=0;
 const profiles=new ModelProfiles({profiles:[{id:'bounded',model:'fixture',provider:'chat-completions',baseUrl:'https://fixture.example/v1',credentialRef:'fixture',invocation:{maxCompletionTokens:8192,reasoningEffort:'high'}}],resolveSecret:async()=> 'fixture',factory:config=>createModelProvider({...config,fetchImpl:async(_url,options)=>{
  const wire=JSON.parse(options.body);assert.equal(wire.max_completion_tokens,8192);assert.equal(wire.reasoning_effort,'high');assert.equal(Object.hasOwn(wire,'reasoning'),false);assert.equal(Object.hasOwn(wire,'max_tokens'),false);boundedCalls++;
  return Response.json({choices:[{finish_reason:'length',message:{content:'partial',reasoning_content:'not exposed'}}],usage:{prompt_tokens:10,completion_tokens:8192,completion_tokens_details:{reasoning_tokens:8000}}});
 }})});
 const bounded=new AssistantModels({settings:{get:async()=>null},profiles,ledger,resolveScope:async()=>scope,tokenPolicies:{bounded:{maximum:9000,price:{revision:'fixture-v1',input:1,cachedInput:1,output:1}}}});
 const selected=await bounded.resolve({actor});
 await assert.rejects(selected.next({messages:[],tools:[],outputSchema:{type:'object'},billingContext:{taskId:'completion-budget-fixture',turn:1}}),error=>error.usage.outputTokens===8192&&error.usage.reasoningOutputTokens===8000);
 assert.equal(boundedCalls,1);assert.equal(await ledger.hasPendingTask(scope,'completion-budget-fixture'),false);
 const measured=await ledger.taskUsage(scope,'completion-budget-fixture');assert.equal(measured.providerTokens,'8202');assert.equal(measured.platformUnits,'8202');assert.equal(measured.complete,true);
 console.log(JSON.stringify({example:'core-model-routing',status:'passed',persistentActualModel:true,serviceReconstruction:true,newTaskUsesCurrentAvailability:true,existingMetering:true,totalCompletionBudget:true,explicitReasoningPolicy:true,truncatedUsageSettled:true,modelMode:'deterministic',processKill:false}));
} finally {await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
