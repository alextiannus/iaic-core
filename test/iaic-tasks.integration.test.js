import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {TaskStore} from '@immedi/iaic-core/tasks/store.js';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
test('IAiC durable tasks and executor admission on real PostgreSQL',{skip:!url},async t=>{
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname));
 const admin=new Pool({connectionString:url});const schema=`iaic_test_${randomUUID().replaceAll('-','')}`;
 await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
 const store=new TaskStore({pool});const actor={scopeId:'E1',subjectId:'one@example.test'};
 const create=(overrides={})=>store.create({actor,capability:'reports.prepare',input:{goal:'Compare'},idempotencyKey:randomUUID(),version:'v1',model:'test-model',...overrides});
 const reset=()=>pool.query('TRUNCATE iaic_tasks CASCADE');let executor;
 try{
  await store.initialize();
  await t.test('concurrent task request identity is stable and payload changes conflict',async()=>{
   const key=randomUUID();const results=await Promise.all(Array.from({length:5},()=>create({idempotencyKey:key})));
   assert.equal(new Set(results.map(r=>r.id)).size,1);
   await assert.rejects(create({idempotencyKey:key,input:{goal:'Changed'}}),{statusCode:409});
   await assert.rejects(store.get({...actor,subjectId:'other'},results[0].id),{statusCode:404});await reset();
  });
  await t.test('only one executor session and one running task can be admitted',async()=>{
   executor=await store.acquireExecutor();assert.ok(executor);assert.equal(await store.acquireExecutor(),null);
   await create();await create();const first=await executor.claim('v1');assert.ok(first);assert.equal(await executor.claim('v1'),null);
   await executor.finish(first.id,{status:'succeeded',result:{report:'verified by caller'}});
   assert.ok(await executor.claim('v1'));await executor.close();executor=null;await reset();
  });
  await t.test('cancel wins admission; already dispatched result is retained and blocks overlap',async()=>{
   executor=await store.acquireExecutor();const task=await create();await executor.claim('v1');
   const prepared=await executor.prepare(task.id,{capability:'records.read',input:{},effect:'read'});
   await executor.dispatch(task.id,prepared.id);await store.transition(actor,task.id,{action:'cancel'});
   await create();assert.equal(await executor.claim('v1'),null);
   await assert.rejects(executor.prepare(task.id,{capability:'records.read',input:{},effect:'read'}),{statusCode:409});
   await executor.settle(task.id,prepared.id,{result:{source:'actual'}});
   assert.equal((await store.get(actor,task.id)).status,'cancelled');
   assert.equal((await store.history(actor,task.id)).calls[0].status,'succeeded');
   assert.ok(await executor.claim('v1'));await executor.close();executor=null;await reset();
  });
  await t.test('cancel before dispatch prevents the prepared operation',async()=>{
   executor=await store.acquireExecutor();const task=await create();await executor.claim('v1');
   const call=await executor.prepare(task.id,{capability:'records.save',input:{},effect:'write'});
   await store.transition(actor,task.id,{action:'cancel'});
   await assert.rejects(executor.dispatch(task.id,call.id),{statusCode:409});
   assert.equal((await store.history(actor,task.id)).calls[0].status,'prepared');
   await executor.close();executor=null;await reset();
  });
  await t.test('lost DB executor session recovers to waiting/unknown and cannot resume blindly',async()=>{
   executor=await store.acquireExecutor();const task=await create();await executor.claim('v1');
   const call=await executor.prepare(task.id,{capability:'records.save',input:{},effect:'write'});await executor.dispatch(task.id,call.id);
   const pid=(await executor.connection.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   await admin.query('SELECT pg_terminate_backend($1)',[pid]);
   await assert.rejects(executor.append(task.id,'progress',{}));await executor.close();executor=null;
   executor=await store.acquireExecutor();assert.equal((await store.get(actor,task.id)).waiting_reason,'interrupted');
   assert.equal((await store.history(actor,task.id)).calls[0].status,'unknown');
   await assert.rejects(store.transition(actor,task.id,{action:'resume',version:'v1'}),/uncertain/);
   await executor.close();executor=null;await reset();
  });
  await t.test('input resumes without overwriting original goal; mismatched versions stay waiting',async()=>{
   executor=await store.acquireExecutor();const task=await create();await executor.claim('v1');
   await executor.finish(task.id,{status:'waiting',reason:'input'});
   await assert.rejects(store.transition(actor,task.id,{action:'provide_input',version:'v2',input:'Extra'}),/version mismatch/);
   await store.transition(actor,task.id,{action:'provide_input',version:'v1',input:'Extra'});
   assert.deepEqual((await store.get(actor,task.id)).input,{goal:'Compare'});
   assert.ok((await store.history(actor,task.id)).events.some(e=>e.kind==='input'&&e.data.text==='Extra'));
   assert.equal(await executor.claim('v2'),null);assert.equal((await store.get(actor,task.id)).status,'waiting');
   await executor.close();executor=null;await reset();
  });
 }finally{if(executor)await executor.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
