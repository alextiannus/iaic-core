import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {TaskStore} from '@immedi/iaic-core/tasks/store.js';
import {hostProjection} from '@immedi/iaic-core/context/host.js';
import {TaskWake} from '@immedi/iaic-core/notifications/task-wake.js';
import {PostgresNotificationStore} from '@immedi/iaic-core/notifications/store.js';
const target={scopeId:'tenant/workspace/market',subjectId:'user'};
const context={source:'host',schema:'fixture',version:'1',reference:'context-1',revision:'1',digest:hostProjection({tenant:'t',workspace:'w',market:'m'}).digest,owner:target};
const intent={topic:'review',target,context,capability:'assistant.work',taskRequestKey:'task-request',input:{goal:'Review only'},authorityRef:'mandate:1'};
async function fixture(run) {
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;assert.ok(connectionString);const schema='wake_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
 try {
  const store=new PostgresNotificationStore({pool,namespace:'fixture'}),tasks=new TaskStore({pool});await store.initialize();await tasks.initialize();
  const state={send:true,reconcile:true,repair:true,admissions:0,repairs:0,lookup:'unknown'};
  const links=new Map();
  const options={store,channel:'wake-fixture',topics:['review'],resolveScope:a=>JSON.stringify([a.scopeId,a.subjectId]),authorizeEnqueue:()=>true,authorizeSend:()=>state.send,authorizeReconcile:()=>state.reconcile,
   admitTask:async({intent:i,idempotencyKey})=>{state.admissions++;const row=await tasks.create({actor:i.target,capability:i.capability,input:i.input,idempotencyKey,version:'fixture',model:'fixture',trustedContext:i.context});return {...row,owner:tasks.actor(row)};},
   findTask:async({intent:i,idempotencyKey})=>{const row=await tasks.findRequest(i.target,i.capability,idempotencyKey);return row?{status:'found',task:{...row,owner:tasks.actor(row)}}:state.lookup==='not_sent'?{status:'not_sent',evidenceRef:'fixture-fenced-no-admission'}:{status:'unknown'};},
   repairBinding:async({intent:i,task})=>{state.repairs++;if(!state.repair)throw Error('Binding storage unavailable');links.set(task.id,structuredClone(i.context));return {bound:true,reference:task.id};}};
  const wake=new TaskWake(options);
  await run({pool,store,tasks,wake,options,state,links});
 } finally {await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
test('Task admission commit followed by binding failure repairs on reconstruction without new send authority',async()=>fixture(async({wake,store,tasks,state,options,links})=>{
 state.repair=false;const job=await wake.enqueue(target,{requestKey:'one',intent});
 assert.equal((await wake.pump()).results[0].state,'unknown');assert.equal(state.admissions,1);assert.equal((await tasks.list(target)).length,1);
 state.send=false;state.repair=true;const recovered=new TaskWake(options);assert.equal((await recovered.pump()).results[0].state,'delivered');assert.equal(links.size,1);assert.equal(state.admissions,1);
 assert.equal((await store.get(job.scopeId,job.requestKey)).state,'delivered');assert.equal((await recovered.pump()).results.length,0);
}));
test('Immutable target and context, explicit owned topics, and changed receipt binding fail closed',async()=>fixture(async({wake,store,pool,state,options})=>{
 const copy=structuredClone(intent);const first=await wake.enqueue(target,{requestKey:'one',intent:copy});copy.input.goal='Changed';
 assert.equal((await store.get(first.scopeId,'one')).source.intent.input.goal,'Review only');
 await assert.rejects(wake.enqueue(target,{requestKey:'one',intent:copy}),{statusCode:409});
 await assert.rejects(wake.enqueue(target,{requestKey:'two',intent:{...intent,topic:'foreign'}}),{statusCode:403});
 await assert.rejects(wake.enqueue(target,{requestKey:'two',intent:{...intent,target:{...target,subjectId:'other'}}}),{statusCode:403});
 state.repair=false;await wake.pump();
 await pool.query("UPDATE iaic_tasks SET trusted_context=jsonb_set(trusted_context,'{revision}','\"changed\"')");
 state.repair=true;const oldRepairs=state.repairs;await new TaskWake(options).pump();assert.equal(state.repairs,oldRepairs);assert.equal((await store.get(first.scopeId,'one')).state,'unknown');
}));
test('Expired worker and missing receipt remain unknown until Host proves no in-flight admission',async()=>fixture(async({wake,store,pool,state})=>{
 const job=await wake.enqueue(target,{requestKey:'one',intent});const claim=await store.claim({channel:job.channel,id:job.id});assert.ok(claim);
 await pool.query("UPDATE iaic_notifications SET lease_until=now()-interval '1 second' WHERE id=$1",[job.id]);
 await wake.pump();await wake.pump();assert.equal(state.admissions,0);assert.equal((await store.get(job.scopeId,'one')).state,'unknown');
 state.lookup='not_sent';assert.equal((await wake.pump()).results[0].state,'failed');assert.equal(state.admissions,0);
 assert.equal((await wake.pump()).results[0].state,'delivered');assert.equal(state.admissions,1);
}));
test('Poison topic and denied reconciliation do not block later pages or touch another channel',async()=>fixture(async({wake,store,state})=>{
 const good=await wake.enqueue(target,{requestKey:'good',intent});
 const bad=await store.enqueue(good.scopeId,{requestKey:'poison',recipientId:target.subjectId,channel:good.channel,message:{},source:{kind:'task-wake/v1',intent:{...intent,topic:'not-owned'}}});
 const foreign=await store.enqueue(good.scopeId,{requestKey:'foreign-channel',recipientId:target.subjectId,channel:'another-worker',message:{},source:{}});
 let after=null,count=0;do {const page=await wake.pump({after,limit:1});count+=page.results.length;after=page.next;}while(after);
 assert.equal(count,2);assert.equal((await store.get(good.scopeId,'good')).state,'delivered');assert.equal((await store.get(bad.scopeId,'poison')).state,'pending');assert.equal((await store.get(foreign.scopeId,'foreign-channel')).state,'pending');
 const second=await wake.enqueue(target,{requestKey:'second',intent:{...intent,taskRequestKey:'second'}});state.repair=false;await wake.pump();state.reconcile=false;
 const third=await wake.enqueue(target,{requestKey:'third',intent:{...intent,taskRequestKey:'third'}});state.repair=true;
 const result=await wake.pump();assert.ok(result.results.some(x=>x.id===second.id&&x.error));assert.equal((await store.get(third.scopeId,'third')).state,'unknown');assert.equal(state.admissions,3);
}));
test('Automatic not_sent retries are bounded; concurrent workers admit only once',async()=>fixture(async({wake,store,state,options})=>{
 state.send=false;const job=await wake.enqueue(target,{requestKey:'denied',intent});await wake.pump();assert.equal(state.admissions,0);await wake.pump();assert.equal((await store.history(job.scopeId,'denied')).length,1);
 state.send=true;await Promise.all([wake.pump(),wake.pump()]);assert.equal(state.admissions,1);
 const denied=new TaskWake({...options,maxAttempts:1,authorizeSend:()=>false});const second=await denied.enqueue(target,{requestKey:'limit',intent:{...intent,taskRequestKey:'limit'}});await denied.pump();
 const enabled=new TaskWake({...options,maxAttempts:1});assert.equal((await enabled.pump()).results.find(x=>x.id===second.id).skipped,'attempt-limit');assert.equal(state.admissions,1);
}));
