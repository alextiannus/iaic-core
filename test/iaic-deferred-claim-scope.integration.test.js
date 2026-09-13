import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {DeferredTaskStore} from '@immedi/iaic-core';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
test('Deferred workers claim only their configured application and job without touching other intents',{skip:!url},async()=>{
 const admin=new Pool({connectionString:url}),schema='claim_scope_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
 try{
  const all=new DeferredTaskStore({pool});await all.initialize();const base={applicationId:'app-a',assistantId:'job-a',subjectId:'owner'},request={dueAt:'2000-01-01T00:00:00Z',input:{goal:'Fixture'}};
  const otherJob=await all.create({...base,assistantId:'job-b'},{...request,requestKey:'other-job'}),otherApp=await all.create({...base,applicationId:'app-b'},{...request,requestKey:'other-app'}),own=await all.create(base,{...request,requestKey:'own'});
  const scope={applicationId:'app-a',assistantId:'job-a'},worker=new DeferredTaskStore({pool,claimScope:scope});scope.assistantId='job-b';
  assert.equal((await worker.claim()).id,own.id);assert.equal(await worker.claim(),null);
  assert.equal((await all.get({...base,assistantId:'job-b'},otherJob.id)).state,'queued');assert.equal((await all.get({...base,applicationId:'app-b'},otherApp.id)).attempts,0);
  const jobWorker=new DeferredTaskStore({pool,claimScope:{assistantId:'job-a'}});assert.equal((await jobWorker.claim()).id,otherApp.id);
  const appWorker=new DeferredTaskStore({pool,claimScope:{applicationId:'app-a'}});assert.equal((await appWorker.claim()).id,otherJob.id);
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
test('Deferred worker claim scope rejects empty or ambiguous filters',()=>{
 for(const claimScope of [{},[],{subjectId:'owner'},{assistantId:''},{applicationId:7}])assert.throws(()=>new DeferredTaskStore({pool:{},claimScope}),/claim scope/);
});
