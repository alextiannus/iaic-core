import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {PostgresSupportStore} from '../support/store.js';
import {SupportIssues} from '../support/service.js';
import {SupportFollowUp,createSupportResolutionConsumer} from '../support/follow-up.js';
import {createSupportCapabilities,createSupportFollowUpCapabilities} from '../support/capabilities.js';
import {CapabilityDispatcher} from '../capabilities/index.js';
import {PostgresNotificationStore} from '../notifications/store.js';
import {Notifications} from '../notifications/service.js';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
async function fixture(run){
 const namespace='support-observation-'+randomUUID(),schema='s_'+randomUUID().replaceAll('-','');
 const admin=new pg.Pool({connectionString:url});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`});
 const store=new PostgresSupportStore({pool,namespace}),notificationStore=new PostgresNotificationStore({pool,namespace});
 await store.initialize();await notificationStore.initialize();
 const user={scopeId:'tenant-a',subjectId:'alice'},engineer={scopeId:'tenant-a',subjectId:'engineer',engineer:true};
 let revoked=false,verified=true,delivery='delivered',readVerified=true,readOverride={},observationOverride={},duringObservation=()=>{},duringRead=()=>{},sends=0;
 const authorize=(a,{action})=>!revoked&&(!['manage','notify'].includes(action)||a.engineer===true);
 const notifications=new Notifications({store:notificationStore,resolveScope:a=>a.scopeId,authorize:a=>a.engineer===true&&!revoked,resolveDelivery:async()=>({allowed:!revoked,send:async()=>{sends++;return {status:delivery}},query:async()=>({status:delivery})})});
 const notificationActor=({identity})=>({...engineer,scopeId:identity.scopeId});
 const options={store,resolveIdentity:a=>a,authorize,notifications,notificationActor,
  resolveObservation:async(sourceId,{identity})=>{duringObservation();return {confirmed:true,...identity,sourceId,summary:'Bounded tool failure',agentId:identity.subjectId,affectedSubjectId:'alice',taskId:'task-ref',evidenceRef:'redacted-ref',...observationOverride}},
  resolveResolution:async(evidenceId,{issue})=>({confirmed:verified,scopeId:issue.scopeId,issueId:issue.id,revision:issue.revision,deployed:true,healthy:true,regressionPassed:true,releaseId:'release-fixed',verificationId:evidenceId})};
 const service=new SupportIssues(options);
 const followOptions={support:service,store,notifications,notificationActor,resolveRead:async(_id,{issue,revision,notificationId})=>{duringRead();return {confirmed:readVerified,scopeId:issue.scopeId,issueId:issue.id,revision,notificationId,recipientId:issue.reporterId,readAt:'2026-10-05T10:00:00Z',...readOverride}}};
 const follow=new SupportFollowUp(followOptions);
 const resolve=async issue=>{for(const state of ['triaged','fixing','verifying','resolved'])issue=await service.update(engineer,{id:issue.id,expectedRevision:issue.revision,state,message:state,evidenceId:'verified-release'});return issue;};
 try{await run({pool,namespace,store,notificationStore,user,engineer,service,follow,options,followOptions,notifications,resolve,
  control:{revoke:v=>revoked=v,verify:v=>verified=v,delivery:v=>delivery=v,readVerified:v=>readVerified=v,readOverride:v=>readOverride=v,observationOverride:v=>observationOverride=v,duringObservation:fn=>duringObservation=fn,duringRead:fn=>duringRead=fn},sends:()=>sends});}
 finally{
  for(const table of ['iaic_support_read_receipts','iaic_support_event_retries','iaic_support_event_receipts','iaic_support_events','iaic_support_issues'])await pool.query(`DELETE FROM ${table} WHERE namespace=$1`,[namespace]);
  await pool.query('DELETE FROM iaic_notification_attempts WHERE notification_id IN(SELECT id FROM iaic_notifications WHERE namespace=$1)',[namespace]);
  await pool.query('DELETE FROM iaic_notifications WHERE namespace=$1',[namespace]);await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
 }
}
test('bounded observations preserve source kind, affected subject and candidate status, with durable source deduplication',{skip:!url},()=>fixture(async f=>{
 const input={sourceId:'failure-source-1'};
 for(const sourceKind of ['user_assistant_detected','business_ai_detected','system_observed']){
  const actor={scopeId:'tenant-a',subjectId:sourceKind,sourceKind};
  const [one,two]=await Promise.all([f.service.observe(actor,input),f.service.observe(actor,input)]);
  assert.equal(one.id,two.id);assert.equal(one.report.sourceKind,sourceKind);assert.equal(one.report.assessment,'candidate');
  assert.equal(one.reporterId,sourceKind);assert.equal(one.report.affectedSubjectId,'alice');
  assert.equal((await new SupportIssues(f.options).observe(actor,input)).id,one.id);
  await assert.rejects(f.service.report(actor,{requestKey:'forged',summary:'I am Alice'}),{code:'SUPPORT_OBSERVATION_REQUIRED'});
  await assert.rejects(f.service.get(f.user,{id:one.id}),{code:'SUPPORT_NOT_FOUND'});
  await assert.rejects(f.service.notify(f.engineer,{id:one.id,revision:1}),{code:'SUPPORT_USER_FOLLOW_UP_NOT_APPLICABLE'});
  f.control.observationOverride({summary:'Changed source content'});
  await assert.rejects(f.service.observe(actor,input),{code:'SUPPORT_REQUEST_CONFLICT'});f.control.observationOverride({});
 }
 assert.deepEqual(await f.service.list(f.user),[]);
 await assert.rejects(f.service.observe(f.user,input),{code:'SUPPORT_OBSERVER_REQUIRED'});
}));
test('observation resolver rejects forged bindings, missing agent identity, unbounded data and revoked authority',{skip:!url},()=>fixture(async f=>{
 const actor={scopeId:'tenant-a',subjectId:'agent',sourceKind:'business_ai_detected'},input={sourceId:'source'};
 for(const override of [{confirmed:false},{scopeId:'other'},{subjectId:'alice'},{sourceKind:'end_user_reported'},{sourceId:'other'}]){
  f.control.observationOverride(override);await assert.rejects(f.service.observe(actor,input),{code:'SUPPORT_OBSERVATION_UNVERIFIED'});
 }
 f.control.observationOverride({agentId:undefined});await assert.rejects(f.service.observe(actor,input),{code:'SUPPORT_OBSERVATION_AGENT_REQUIRED'});
 f.control.observationOverride({summary:'x'.repeat(2001)});await assert.rejects(f.service.observe(actor,input),{code:'SUPPORT_INVALID_TEXT'});
 f.control.observationOverride({});f.control.duringObservation(()=>f.control.revoke(true));
 await assert.rejects(f.service.observe(actor,input),{code:'SUPPORT_ACCESS_DENIED'});f.control.revoke(false);
 assert.deepEqual(await f.service.queue(f.engineer),[]);
 f.control.duringObservation(()=>{actor.subjectId='replacement-agent'});
 await assert.rejects(f.service.observe(actor,input),{code:'SUPPORT_ACCESS_DENIED'});
 assert.deepEqual(await f.service.queue(f.engineer),[]);
}));
test('resolved user reports recover notification admission after lost acknowledgement; delivered is not read; reopen retains history',{skip:!url},()=>fixture(async f=>{
 const received=await f.service.report(f.user,{requestKey:'report',summary:'用户反馈 / user report / laporan pengguna'});
 f.control.verify(false);
 await f.service.update(f.engineer,{id:received.id,expectedRevision:1,state:'triaged',message:'triaged'});
 await f.service.update(f.engineer,{id:received.id,expectedRevision:2,state:'fixing',message:'fixing'});
 await f.service.update(f.engineer,{id:received.id,expectedRevision:3,state:'verifying',message:'verifying'});
 await assert.rejects(f.service.update(f.engineer,{id:received.id,expectedRevision:4,state:'resolved',message:'trust me',evidenceId:'fake'}),{code:'SUPPORT_RESOLUTION_UNVERIFIED'});
 f.control.verify(true);const issue=await f.service.update(f.engineer,{id:received.id,expectedRevision:4,state:'resolved',message:'verified',evidenceId:'release-proof'});
 const input={id:issue.id,revision:issue.revision};
 assert.equal((await f.follow.get(f.user,input)).admission,'not_admitted');
 let lost=true;const original=f.store.acknowledgeEvent.bind(f.store);
 f.store.acknowledgeEvent=async(...args)=>{if(args[1].revision===5&&lost){lost=false;throw Error('lost ack after admission')}return original(...args)};
 const consumer=()=>createSupportResolutionConsumer({support:new SupportIssues(f.options),store:f.store,consumerId:'resolved-followup',resolveActor:()=>f.engineer});
 assert.equal((await consumer().tick()).failed.length,1);
 const admitted=await f.follow.get(f.user,input);assert.equal(admitted.admission,'admitted');assert.equal(admitted.delivery,'pending');assert.equal(admitted.read,'not_verified');
 assert.equal((await consumer().tick()).acknowledged,1);assert.equal((await consumer().tick()).acknowledged,0);
 assert.equal((await f.follow.get(f.user,input)).notificationId,admitted.notificationId);
 await assert.rejects(f.follow.recordRead(f.engineer,{...input,evidenceId:'read-ref'}),{code:'SUPPORT_DELIVERY_NOT_VERIFIED'});
 f.control.delivery('unknown');await f.notifications.tick();assert.equal((await f.follow.get(f.user,input)).delivery,'unknown');
 await consumer().tick();assert.equal(await f.notifications.tick(),null);assert.equal(f.sends(),1);
 f.control.delivery('delivered');await f.notifications.reconcile(f.engineer,{requestKey:`support:${issue.id}:5`});
 assert.equal((await f.follow.get(f.user,input)).read,'not_verified');
 f.control.readVerified(false);await assert.rejects(f.follow.recordRead(f.engineer,{...input,evidenceId:'read-ref'}),{code:'SUPPORT_READ_UNVERIFIED'});f.control.readVerified(true);
 for(const readOverride of [{scopeId:'other'},{issueId:randomUUID()},{revision:1},{recipientId:'bob'},{notificationId:randomUUID()},{readAt:'bad'}]){
  f.control.readOverride(readOverride);await assert.rejects(f.follow.recordRead(f.engineer,{...input,evidenceId:'read-ref'}),{code:'SUPPORT_READ_UNVERIFIED'});
 }
 f.control.readOverride({});
 const read=await f.follow.recordRead(f.engineer,{...input,evidenceId:'read-ref'});assert.equal(read.read,'read');
 assert.deepEqual(await new SupportFollowUp(f.followOptions).recordRead(f.engineer,{...input,evidenceId:'read-ref'}),read);
 await assert.rejects(f.follow.recordRead(f.engineer,{...input,evidenceId:'different-ref'}),{code:'SUPPORT_READ_RECEIPT_CONFLICT'});
 await f.service.update(f.user,{id:issue.id,expectedRevision:5,state:'reopened',message:'still broken'});
 const historical=await f.follow.get(f.user,input);assert.equal(historical.historical,true);assert.equal(historical.currentRevision,6);assert.equal(historical.read,'read');
 for(const actor of [{...f.user,subjectId:'bob'},{...f.user,scopeId:'other'}])await assert.rejects(f.follow.get(actor,input),{code:'SUPPORT_NOT_FOUND'});
 await assert.rejects(f.follow.recordRead(f.user,{...input,evidenceId:'self-verdict'}),{code:'SUPPORT_ACCESS_DENIED'});
}));
test('follow-up rejects cross-recipient notifications and revoked read evidence; agent resolutions do not notify affected users',{skip:!url},()=>fixture(async f=>{
 const issue=await f.resolve(await f.service.report(f.user,{requestKey:'one',summary:'failure'})),input={id:issue.id,revision:5};
 await f.service.notify(f.engineer,input);await f.notifications.tick();
 const real=f.notifications.get.bind(f.notifications);f.notifications.get=async(...args)=>({...await real(...args),recipientId:'bob'});
 await assert.rejects(f.follow.get(f.user,input),{code:'SUPPORT_FOLLOW_UP_BINDING_MISMATCH'});f.notifications.get=real;
 f.control.duringRead(()=>f.control.revoke(true));await assert.rejects(f.follow.recordRead(f.engineer,{...input,evidenceId:'read-ref'}),{code:'SUPPORT_ACCESS_DENIED'});f.control.revoke(false);
 assert.equal((await f.follow.get(f.user,input)).read,'not_verified');
 const actor={scopeId:'tenant-a',subjectId:'business-agent',sourceKind:'business_ai_detected'};
 await f.resolve(await f.service.observe(actor,{sourceId:'business-failure'}));
 const consumer=createSupportResolutionConsumer({support:f.service,store:f.store,consumerId:'followup',resolveActor:()=>f.engineer});
 assert.equal((await consumer.tick()).failed.length,0);
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM iaic_notifications WHERE namespace=$1',[f.namespace])).rows[0].n,1);
}));
test('public observation/follow-up schemas reject caller identity, facts and read verdicts',async()=>{
 let called=false;const dispatcher=new CapabilityDispatcher({capabilities:[...createSupportCapabilities({support:{observe:()=>{called=true}}}),...createSupportFollowUpCapabilities({followUp:{get:()=>{called=true},recordRead:()=>{called=true}}})]});
 for(const forged of [{sourceKind:'end_user_reported'},{summary:'private dump'},{affectedSubjectId:'victim'},{confirmed:true}])await assert.rejects(dispatcher.invoke('support.observe',{sourceId:'source',...forged},{actor:{}}));
 await assert.rejects(dispatcher.invoke('support.record_read',{id:randomUUID(),revision:5,evidenceId:'e',read:true},{actor:{}}));assert.equal(called,false);
});

// Review regression: revoke precisely while the final status query is in flight.
test('follow-up fails closed when authority changes during the final issue read',{skip:!url},()=>fixture(async f=>{
 const issue=await f.resolve(await f.service.report(f.user,{requestKey:'read-race',summary:'private'}));
 const original=f.store.get.bind(f.store);let reads=0;
 f.store.get=async(...args)=>{const row=await original(...args);if(++reads===3)f.control.revoke(true);return row;};
 await assert.rejects(f.follow.get(f.user,{id:issue.id,revision:5}),{code:'SUPPORT_ACCESS_DENIED'});
}));
// Review regression: a revoked scope must not monopolize every pending page.
test('resolution consumer defers failed admissions durably so later authorized reports progress',{skip:!url},()=>fixture(async f=>{
 const blocked=await f.resolve(await f.service.report(f.user,{requestKey:'blocked',summary:'blocked'}));
 const good=await f.resolve(await f.service.report(f.user,{requestKey:'good',summary:'good'}));
 const consumerId='fair-follow-up';
 // Non-resolved history was already acknowledged by the same deployed consumer.
 for(const event of await f.store.pendingEvents(consumerId,{limit:100}))if(event.state!=='resolved')await f.store.acknowledgeEvent(consumerId,event);
 await f.pool.query("UPDATE iaic_support_events SET created_at=now()-interval '1 hour' WHERE namespace=$1 AND issue_id=$2",[f.namespace,blocked.id]);
 let attempts=0;
 const support=new SupportIssues({...f.options,notificationActor:async context=>{if(context.issue.id===blocked.id){attempts++;throw Error('scope temporarily unavailable')}return f.engineer;}});
 const worker=()=>createSupportResolutionConsumer({support,store:f.store,consumerId,resolveActor:()=>f.engineer});
 assert.equal((await worker().tick({limit:1})).failed.length,1);
 // Backoff persists across restarts; even slower polling after expiry rotates failures.
 assert.equal((await f.store.pendingEvents(consumerId,{limit:1}))[0].issueId,good.id);
 await f.pool.query("UPDATE iaic_support_event_retries SET retry_after=now()-interval '1 second' WHERE namespace=$1",[f.namespace]);
 assert.equal((await worker().tick({limit:1})).acknowledged,1);
 assert.equal((await f.follow.get(f.user,{id:good.id,revision:5})).admission,'admitted');assert.equal(attempts,1);
 assert.equal((await worker().tick({limit:1})).failed.length,1);assert.equal(attempts,2);
 assert.equal((await worker().tick({limit:1})).acknowledged,0);
 // A deferred event is not acknowledged or discarded; it becomes eligible again.
 await f.pool.query("UPDATE iaic_support_event_retries SET retry_after=now()-interval '1 second' WHERE namespace=$1",[f.namespace]);
 assert.equal((await worker().tick({limit:1})).failed.length,1);assert.equal(attempts,3);
 assert.throws(()=>createSupportResolutionConsumer({support,store:f.store,consumerId,resolveActor:()=>f.engineer,retryDelaySeconds:0}),{code:'SUPPORT_INVALID_RETRY_DELAY'});
}));
