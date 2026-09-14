import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {PeerReviews,WorkspaceReviewStore,createPeerReviewCapabilities,CapabilityDispatcher,PostgresWorkspaceStore,AssistantWorkspace} from '@immedi/iaic-core';

test('Reciprocal reviews retain exact artifacts, authors and follow-up findings across reconstruction',async()=>{
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;
 assert.ok(connectionString,'Isolated PostgreSQL URL required');
 const admin=new Pool({connectionString}),schema='peer_reviews_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
 try{
  const documents=new PostgresWorkspaceStore({pool});await documents.initialize();
  const builtin={subjectId:'builtin'},external={subjectId:'external'},service={subjectId:'review-service'};
  const members=new Set(['builtin','external']);
  const workspace=new AssistantWorkspace({store:documents,resolveScope:async()=>({applicationId:'team',assistantId:'platform',subjectId:'shared-artifacts'}),sourceFor:async actor=>({kind:'platform-work',author:actor.subjectId})});
  const evidence=new AssistantWorkspace({store:documents,resolveScope:async actor=>{assert.equal(actor,service);return {applicationId:'team',assistantId:'platform',subjectId:'review-evidence'};},sourceFor:()=>({kind:'peer-review-service'})});
  const ports={readArtifact:async(actor,ref)=>{assert.ok(members.has(actor.subjectId));const artifact=await workspace.read(actor,ref);return {reference:artifact.reference,author:artifact.source.author};},resolvePrincipal:actor=>actor.subjectId,authorize:(actor)=>members.has(actor.subjectId)};
  const open=()=>new PeerReviews({...ports,store:new WorkspaceReviewStore({workspace:evidence,actor:service})});
  const reviews=open(),dispatcher=new CapabilityDispatcher({capabilities:createPeerReviewCapabilities({reviews})});
  const original=await workspace.write(external,{path:'change.md',content:'Missing failure handling',expectedRevision:0});
  const input={id:'review-1',target:original.reference,verdict:'changes_requested',findings:'Handle the original unknown receipt before continuing.'};
  const first=await dispatcher.invoke('collaboration.reviews.record',input,{actor:builtin,callId:input.id});
  assert.equal(first.reviewer,'builtin');assert.equal(first.author,'external');
  assert.deepEqual(await open().record(builtin,input),first);
  const concurrent=await Promise.all([open().record(builtin,{...input,id:'concurrent'}),open().record(builtin,{...input,id:'concurrent'})]);
  assert.deepEqual(concurrent[0],concurrent[1]);
  await assert.rejects(reviews.record(builtin,{...input,findings:'Changed evidence'}),{statusCode:409});
  await assert.rejects(reviews.record(external,{...input,id:'self-review'}),{statusCode:409});
  await assert.rejects(reviews.record(builtin,{...input,id:'bad-reference',target:{path:input.target.path}}),{statusCode:400});
  const revision=await workspace.write(external,{path:'change.md',content:'Query original receipt; continue remaining work',expectedRevision:1});
  const followup=await reviews.record(builtin,{...input,id:'review-2',target:revision.reference,verdict:'no_findings',findings:'The reported failure path is addressed.',previousReviewId:first.id});
  assert.equal(followup.previousReviewId,first.id);
  assert.equal((await open().read(external,first.id)).target.revision,1);
  assert.equal((await open().read(external,followup.id)).target.revision,2);
  const covered=await workspace.write(builtin,{path:'change.md',content:'Teammate adds missing verification evidence',expectedRevision:2});
  const coveredReview=await reviews.record(external,{id:'cover-review',target:covered.reference,verdict:'no_findings',findings:'Verified the teammate correction.',previousReviewId:followup.id});
  assert.equal(coveredReview.author,'builtin');assert.equal(coveredReview.reviewer,'external');
  assert.equal(coveredReview.previousReviewId,followup.id);
  const nativeWork=await workspace.write(builtin,{path:'plan.md',content:'Plan from built-in Platform Agent',expectedRevision:0});
  const reverse=await reviews.record(external,{id:'reverse',target:nativeWork.reference,verdict:'inconclusive',findings:'Needs an actual execution result.'});
  assert.equal(reverse.author,'builtin');assert.equal(reverse.reviewer,'external');
  assert.equal((await reviews.read(builtin,reverse.id)).verdict,'inconclusive');
  await assert.rejects(reviews.record(external,{id:'bad-link',target:nativeWork.reference,verdict:'no_findings',findings:'Wrong target',previousReviewId:first.id}),{statusCode:409});
  const historyCapability=dispatcher.capabilities.get('collaboration.reviews.record');
  members.delete('builtin');
  await assert.rejects(historyCapability.revalidate(input,first,{actor:builtin}),{statusCode:403});
  members.add('builtin');
  await workspace.remove(external,{path:'change.md',expectedRevision:3});
  await assert.rejects(reviews.read(builtin,first.id),{statusCode:404});
  assert.equal((await new WorkspaceReviewStore({workspace:evidence,actor:service}).get(first.id)).findings,input.findings);
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});

test('Lost review-write acknowledgement is recoverable by the original ID without changing findings',async()=>{
 const target={path:'patch.md',revision:1,digest:'a'.repeat(64)};let saved=null,writes=0;
 const reviews=new PeerReviews({store:{get:async()=>saved,put:async record=>{writes++;saved=structuredClone(record);throw new Error('lost acknowledgement');}},readArtifact:async()=>({reference:target,author:'external'}),resolvePrincipal:()=> 'builtin',authorize:()=>true});
 await assert.rejects(reviews.record({}, {id:'original',target,verdict:'changes_requested',findings:'Fix the failure path.'}),/lost acknowledgement/);
 assert.equal((await reviews.read({},'original')).findings,'Fix the failure path.');
 assert.equal(writes,1);
});
