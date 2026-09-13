import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {DeferredTaskStore,DeferredTasks,TaskCompletionTriggers,TaskStore} from '@immedi/iaic-core';
const connectionString=process.env.DATABASE_URL||process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL URL required');
const admin=new Pool({connectionString}),schema='triggers_example_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
try{
 const actor={scopeId:'trigger-demo',subjectId:'reader'},scope={applicationId:'trigger-demo',assistantId:'helper',subjectId:'reader'},tasks=new TaskStore({pool}),store=new DeferredTaskStore({pool});await tasks.initialize();await store.initialize();
 const source=await tasks.create({actor,capability:'draft',input:{goal:'Prepare source'},idempotencyKey:'source',version:'v1',model:'fixture'});
 const triggers=new TaskCompletionTriggers({readTask:async(actor,id)=>{const t=await tasks.get(actor,id);return {id:t.id,status:t.status,updatedAt:t.updated_at};}});
 const ports={store,triggers,resolveScope:async()=>scope,restoreActor:async()=>actor,validateInput:async()=>{},findTask:(actor,key)=>tasks.findRequest(actor,'draft',key),startTask:(actor,input,key)=>tasks.create({actor,capability:'draft',input,idempotencyKey:key,version:'v1',model:'fixture'})},worker=new DeferredTasks(ports);
 const row=await triggers.followUp(worker,actor,{requestKey:'after-source',trigger:{kind:'task',taskId:source.id,on:'succeeded'},input:{goal:'Continue source'}});const waiting=await worker.tick();assert.equal(waiting.state,'queued');assert.equal(waiting.attempts,0);assert.equal(waiting.taskId,null);
 const executor=await tasks.acquireExecutor();try{assert.equal((await executor.claim('v1')).id,source.id);await executor.finish(source.id,{status:'succeeded',result:{verified:true}});}finally{await executor.close();}
 await pool.query('UPDATE iaic_deferred_tasks SET next_attempt_at=now() WHERE id=$1',[row.id]);const receipt=await new DeferredTasks(ports).tick();assert.equal(receipt.state,'dispatched');assert.equal(receipt.triggerReceipt.taskId,source.id);assert.equal((await tasks.get(actor,receipt.taskId)).input.sourceTaskId,source.id);assert.equal(await worker.tick(),null);
 console.log(JSON.stringify({application:'core-triggers',durableCompletionSource:true,waitsWithoutInference:true,existingDispatcher:true,singleFollowup:true,erpUsed:false}));
}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
