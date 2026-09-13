import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {EventStore,AssistantEvents,PostgresEventSubscriptions,EventSubscriptions,EventTaskSubscriptions,EVENT_SUBSCRIPTION_TASK_PREFIX,DeferredTaskStore,createAgentDeferredTasks,TaskStore,AgentRuntime,ContextAssembler,CapabilityDispatcher,defineCapability} from '@immedi/iaic-core';
async function fixture(fn){const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');const schema='event_task_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let runtime;
 try{
  const actor={subjectId:'owner',scopeId:'app'},scope={applicationId:'app',assistantId:'job',subjectId:'owner'};let allowed=true,plans=0,modelCalls=0;
  const check=a=>{if(!allowed||a.subjectId!==actor.subjectId||a.scopeId!==actor.scopeId)throw Object.assign(new Error('Current access denied'),{statusCode:403});return scope;};
  const events=new EventStore({pool});await events.initialize();const inbox=new AssistantEvents({store:events,resolveScope:check,sourceFor:()=>({kind:'fixture'})});
  const checkpoints=new PostgresEventSubscriptions({pool});await checkpoints.initialize();
  const subscriptions=new EventSubscriptions({store:checkpoints,events,resolveScope:check,authorize:()=>allowed});await subscriptions.subscribe(actor,{key:'work',prefix:'ready:'});
  const read=defineCapability({name:'events.read',description:'Read the pinned source event',input:{type:'object',properties:{key:{type:'string'}},required:['key'],additionalProperties:false},output:{type:'object'},effect:'read',authorize:a=>Boolean(check(a)),revalidate:(i,_r,c)=>inbox.read(c.actor,i),implementation:{kind:'function',execute:(i,c)=>inbox.read(c.actor,i)}});
  const agent=defineCapability({name:'event.work',description:'Work from an event',input:{type:'object',properties:{goal:{type:'string'},sourceEventKey:{type:'string'},allowedTools:{type:'array',items:{type:'string'}}},required:['goal','sourceEventKey','allowedTools'],additionalProperties:false},output:{type:'object'},effect:'read',authorize:a=>Boolean(check(a)),implementation:{kind:'agent',instructions:'Read the event and verify the result',tools:[read.name],allowCall:(input,action)=>action.name===read.name&&action.input.key===input.sourceEventKey,verify:async(input,result,{history})=>history.calls.some(c=>c.capability===read.name&&c.result?.key===input.sourceEventKey&&c.result?.data.value===result.value)}});
  const dispatcher=new CapabilityDispatcher({capabilities:[read,agent]}),tasks=new TaskStore({pool}),deferredStore=new DeferredTaskStore({pool,retryMs:0});await deferredStore.initialize();
  const model={name:'fixture',next:async r=>{modelCalls++;const c=JSON.parse(r.messages.find(m=>m.role==='user').content),call=c.calls.find(x=>x.status==='succeeded');return call?{type:'finish',result:{value:call.result.data.value}}:{type:'call',name:read.name,input:{key:c.goal.sourceEventKey}};}};
  const build=async()=>{await runtime?.stop();runtime=new AgentRuntime({store:tasks,dispatcher,model,context:new ContextAssembler({skillRoot:'/tmp'}),version:'event-task-v1'});dispatcher.tasks=runtime;await runtime.initialize();return runtime;};await build();
  const deferred=createAgentDeferredTasks({name:agent.name,store:deferredStore,resolveScope:check,restoreActor:()=>actor,dispatcher,taskStore:tasks,reservedPrefixes:['agent-call:',EVENT_SUBSCRIPTION_TASK_PREFIX]});
  const create=()=>new EventTaskSubscriptions({subscriptions,deferred,buildTask:(_a,e)=>{plans++;return {goal:'Read and verify the source event',allowedTools:[read.name]};}});
  await fn({actor,scope,pool,inbox,subscriptions,checkpoints,deferred,tasks,create,build,runtime:()=>runtime,deny:()=>{allowed=false;},counts:()=>({plans,modelCalls})});
 }finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
test('Event feed creates original Agent Tasks after lost queue acknowledgement without replanning',async()=>fixture(async f=>{
 const empty=await f.create().tick(f.actor,{key:'work'});assert.equal(empty.handled.length,0);assert.deepEqual(f.counts(),{plans:0,modelCalls:0});
 const event=await f.inbox.publish(f.actor,{key:'ready:one',data:{value:7}});const schedule=f.deferred.schedule.bind(f.deferred);let calls=0;
 f.deferred.schedule=async(...args)=>{calls++;await schedule(...args);throw Object.assign(new Error('Queue commit acknowledgement lost'),{outcomeUnknown:true});};
 await assert.rejects(f.create().tick(f.actor,{key:'work'}),{outcomeUnknown:true});assert.equal((await f.subscriptions.status(f.actor,{key:'work'})).cursor,'0');assert.equal((await f.deferred.list(f.actor,{})).items.length,1);
 f.deferred.schedule=schedule;const recovered=f.create();recovered.buildTask=()=>{throw new Error('Do not replace the original plan');};const result=await recovered.tick(f.actor,{key:'work'});assert.equal(result.handled[0].eventId,event.id);assert.equal(calls,1);assert.equal(f.counts().plans,1);
 await f.build();assert.equal((await f.deferred.tick()).state,'dispatched');const task=await f.runtime().tick();assert.equal(task.status,'succeeded');assert.equal(task.result.value,7);
 await f.create().tick(f.actor,{key:'work'});assert.equal((await f.pool.query('SELECT count(*) FROM iaic_tasks')).rows[0].count,'1');assert.equal(f.counts().modelCalls,2);
}));
test('Concurrent consumers and lost checkpoint acknowledgement preserve one queue intent per source',async()=>fixture(async f=>{
 await f.inbox.publish(f.actor,{key:'ready:one',data:{value:1}});const ack=f.subscriptions.acknowledge.bind(f.subscriptions);
 f.subscriptions.acknowledge=async(...a)=>{await ack(...a);throw Object.assign(new Error('Checkpoint acknowledgement lost'),{outcomeUnknown:true});};await assert.rejects(f.create().tick(f.actor,{key:'work'}),{outcomeUnknown:true});f.subscriptions.acknowledge=ack;
 assert.equal((await f.create().tick(f.actor,{key:'work'})).handled.length,0);
 await f.inbox.publish(f.actor,{key:'ready:two',data:{value:2}});await Promise.all([f.create().tick(f.actor,{key:'work'}),f.create().tick(f.actor,{key:'work'})]);
 assert.equal((await f.deferred.list(f.actor,{})).items.length,2);await f.deferred.tick();await f.runtime().tick();await f.deferred.tick();await f.runtime().tick();assert.equal((await f.pool.query('SELECT count(*) FROM iaic_tasks')).rows[0].count,'2');
}));
test('Current authorization and source binding stop advancement without discarding queued work',async()=>fixture(async f=>{
 await f.inbox.publish(f.actor,{key:'ready:one',data:{value:1}});const wrong=f.create();wrong.buildTask=()=>({goal:'Wrong event',sourceEventKey:'other',allowedTools:['events.read']});await assert.rejects(wrong.tick(f.actor,{key:'work'}));assert.equal((await f.deferred.list(f.actor,{})).items.length,0);
 const schedule=f.deferred.schedule.bind(f.deferred);f.deferred.schedule=async(...a)=>{const intent=await schedule(...a);f.deny();return intent;};await assert.rejects(f.create().tick(f.actor,{key:'work'}),{statusCode:403});
 assert.equal((await f.checkpoints.read(f.scope,{key:'work'})).cursor,'0');assert.equal((await f.pool.query('SELECT count(*) FROM iaic_deferred_tasks')).rows[0].count,'1');
}));
