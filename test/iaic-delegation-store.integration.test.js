import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';import {TaskStore} from '@immedi/iaic-core/tasks/store.js';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
test('Delegation receipts are atomic, owner/version fenced, single-use and cannot override cancellation or uncertain calls',{skip:!url},async()=>{
 const admin=new Pool({connectionString:url}),schema='delegation_store_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});const store=new TaskStore({pool}),actor={scopeId:'app',subjectId:'owner'};let executor;
 const create=overrides=>store.create({actor,capability:'agent.run',input:{goal:'goal'},idempotencyKey:randomUUID(),version:'v1',model:'fixture',...overrides});const intent={request:{goal:'child'},deadlineAt:'2099-01-01T00:00:00Z'};
 try{
  await store.initialize();await store.initialize();executor=await store.acquireExecutor();
  const task=await create();await executor.claim('v1');const delegated=await executor.delegate(task.id,intent);
  assert.equal((await store.pendingDelegation('v1')).id,task.id);assert.equal(await store.pendingDelegation('v2'),null);
  const receive={version:'v1',delegationId:delegated.id,receipt:{state:'finished',childTaskId:randomUUID()}};
  assert.equal(await store.receiveDelegation({...actor,subjectId:'other'},task.id,receive),false);assert.equal(await store.receiveDelegation(actor,task.id,{...receive,version:'v2'}),false);assert.equal(await store.receiveDelegation(actor,task.id,{...receive,delegationId:randomUUID()}),false);
  await assert.rejects(store.transition(actor,task.id,{action:'provide_input',input:'Continue',version:'v1'}),/Delegation/);
  const receipts=await Promise.all([store.receiveDelegation(actor,task.id,receive),store.receiveDelegation(actor,task.id,receive)]);assert.deepEqual(receipts.sort(),[false,true]);assert.equal((await store.history(actor,task.id)).events.filter(e=>e.kind==='delegation_received').length,1);
  await executor.claim('v1');await assert.rejects(executor.delegate(task.id,intent),/one non-nested/);await executor.finish(task.id,{status:'succeeded'});
  const cancelled=await create();await executor.claim('v1');const c=await executor.delegate(cancelled.id,intent);await store.transition(actor,cancelled.id,{action:'cancel'});assert.equal(await store.receiveDelegation(actor,cancelled.id,{...receive,delegationId:c.id}),false);assert.equal(await store.pendingDelegation('v1'),null);
  const uncertain=await create();await executor.claim('v1');await executor.prepare(uncertain.id,{capability:'write',input:{},effect:'write'});await assert.rejects(executor.delegate(uncertain.id,intent),/Uncertain/);await store.transition(actor,uncertain.id,{action:'cancel'});
  const child=await create({handoff:{id:randomUUID(),parentTaskId:task.id}});await executor.claim('v1');await assert.rejects(executor.delegate(child.id,intent),/non-nested/);
 }finally{await executor?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
