import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {EventStore,AssistantEvents,PostgresEventSubscriptions,EventSubscriptions,EventTaskSubscriptions,EVENT_SUBSCRIPTION_TASK_PREFIX,DeferredTaskStore,createAgentDeferredTasks,TaskStore,AgentRuntime,ContextAssembler,CapabilityDispatcher,defineCapability} from '@immedi/iaic-core';
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');
const schema='event_agent_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let runtime;
try{
 const actor={subjectId:'worker',scopeId:'example'},scope={applicationId:'example',assistantId:'job',subjectId:'worker'},authorize=a=>a.subjectId===actor.subjectId&&a.scopeId===actor.scopeId;
 const resolveScope=a=>{if(!authorize(a))throw Object.assign(new Error('Access denied'),{statusCode:403});return scope;};
 const events=new EventStore({pool}),checkpoints=new PostgresEventSubscriptions({pool}),queue=new DeferredTaskStore({pool});for(const store of [events,checkpoints,queue])await store.initialize();
 const inbox=new AssistantEvents({store:events,resolveScope,sourceFor:()=>({kind:'fixture'})});
 const subscriptions=new EventSubscriptions({store:checkpoints,events,resolveScope,authorize});await subscriptions.subscribe(actor,{key:'summary',prefix:'source:'});
 const read=defineCapability({name:'source.read',description:'Read the original event',input:{type:'object',properties:{key:{type:'string'}},required:['key'],additionalProperties:false},output:{type:'object'},effect:'read',authorize,implementation:{kind:'function',execute:(i,c)=>inbox.read(c.actor,i)},revalidate:(i,_r,c)=>inbox.read(c.actor,i)});
 const agent=defineCapability({name:'source.work',description:'Read and verify event source',input:{type:'object',properties:{goal:{type:'string'},sourceEventKey:{type:'string'},allowedTools:{type:'array',items:{type:'string'}}},required:['goal','sourceEventKey','allowedTools'],additionalProperties:false},output:{type:'object'},effect:'read',authorize,implementation:{kind:'agent',instructions:'Read the pinned source and return its value',tools:[read.name],allowCall:(i,a)=>a.name===read.name&&a.input.key===i.sourceEventKey,verify:async(i,r,{history})=>history.calls.some(c=>c.status==='succeeded'&&c.result?.key===i.sourceEventKey&&c.result.data.value===r.value)}});
 const dispatcher=new CapabilityDispatcher({capabilities:[read,agent]}),tasks=new TaskStore({pool});let modelCalls=0;
 const model={name:'fixture',next:async r=>{modelCalls++;const c=JSON.parse(r.messages.find(m=>m.role==='user').content),call=c.calls.find(x=>x.status==='succeeded');return call?{type:'finish',result:{value:call.result.data.value}}:{type:'call',name:read.name,input:{key:c.goal.sourceEventKey}};}};
 const build=async()=>{await runtime?.stop();runtime=new AgentRuntime({store:tasks,dispatcher,model,context:new ContextAssembler({skillRoot:'/tmp'}),version:'event-agent-v1'});dispatcher.tasks=runtime;await runtime.initialize();};await build();
 const deferred=createAgentDeferredTasks({name:agent.name,store:queue,resolveScope,restoreActor:()=>actor,dispatcher,taskStore:tasks,reservedPrefixes:['agent-call:',EVENT_SUBSCRIPTION_TASK_PREFIX]});
 const consumer=()=>new EventTaskSubscriptions({subscriptions,deferred,buildTask:()=>({goal:'Read and verify the original source',allowedTools:[read.name]})});
 assert.equal((await consumer().tick(actor,{key:'summary'})).handled.length,0);assert.equal(modelCalls,0);
 await inbox.publish(actor,{key:'source:one',data:{value:42}});
 const schedule=deferred.schedule.bind(deferred);deferred.schedule=async(...args)=>{await schedule(...args);throw Object.assign(new Error('Queue response lost'),{outcomeUnknown:true});};await assert.rejects(consumer().tick(actor,{key:'summary'}),{outcomeUnknown:true});deferred.schedule=schedule;
 await build();const restored=consumer();restored.buildTask=()=>{throw new Error('Original plan must be reused');};assert.equal((await restored.tick(actor,{key:'summary'})).handled.length,1);
 assert.equal((await deferred.tick()).state,'dispatched');const done=await runtime.tick();assert.equal(done.status,'succeeded');assert.equal(done.result.value,42);
 assert.equal((await consumer().tick(actor,{key:'summary'})).handled.length,0);assert.equal((await pool.query('SELECT count(*) FROM iaic_tasks')).rows[0].count,'1');assert.equal(modelCalls,2);
 console.log(JSON.stringify({example:'core-event-agent',status:'passed',originalTaskCount:1,modelCalls,noInferenceForEmptyFeed:true,queueReceiptRecovered:true,sourcePinned:true,runtimeReconstructed:true,actualModel:false}));
}finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
