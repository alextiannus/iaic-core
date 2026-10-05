import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {SupportIssues} from '@immedi/iaic-core/support/service.js';
import {PostgresSupportStore} from '@immedi/iaic-core/support/store.js';
import {SupportFollowUp,createSupportResolutionConsumer} from '@immedi/iaic-core/support/follow-up.js';
import {Notifications} from '@immedi/iaic-core/notifications/service.js';
import {PostgresNotificationStore} from '@immedi/iaic-core/notifications/store.js';
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL;
if(!connectionString)throw Error('Isolated PostgreSQL URL required');
const schema='support_example_'+randomUUID().replaceAll('-',''),namespace='example';
const admin=new pg.Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new pg.Pool({connectionString,options:`-c search_path=${schema}`});
try{
 const store=new PostgresSupportStore({pool,namespace}),outbox=new PostgresNotificationStore({pool,namespace});await store.initialize();await outbox.initialize();
 const user={scopeId:'demo',subjectId:'reporter'},agent={scopeId:'demo',subjectId:'agent',sourceKind:'business_ai_detected'},engineer={scopeId:'demo',subjectId:'engineer',manage:true};
 const notifications=new Notifications({store:outbox,resolveScope:a=>a.scopeId,authorize:a=>a.manage===true,resolveDelivery:()=>({allowed:true,send:async()=>({status:'delivered'})})});
 const support=new SupportIssues({store,resolveIdentity:a=>a,authorize:(a,{action})=>!['manage','notify'].includes(action)||a.manage===true,
  resolveObservation:(sourceId,{identity})=>({confirmed:true,...identity,sourceId,summary:'Synthetic tool failure',agentId:identity.subjectId,evidenceRef:'fixture-tool-1'}),
  resolveResolution:(id,{issue})=>({confirmed:true,scopeId:issue.scopeId,issueId:issue.id,revision:issue.revision,deployed:true,healthy:true,regressionPassed:true,releaseId:'fixture-release',verificationId:id}),notifications,notificationActor:()=>engineer});
 const detected=await support.observe(agent,{sourceId:'fixture-source'});assert.equal(detected.report.assessment,'candidate');assert.equal((await support.observe(agent,{sourceId:'fixture-source'})).id,detected.id);
 let issue=await support.report(user,{requestKey:'fixture-user-report',summary:'The operation failed'});
 for(const state of ['triaged','fixing','verifying','resolved'])issue=await support.update(engineer,{id:issue.id,expectedRevision:issue.revision,state,message:state,evidenceId:'fixture-regression'});
 const followUp=new SupportFollowUp({support,store,notifications,notificationActor:()=>engineer,resolveRead:(_id,{issue,revision,notificationId})=>({confirmed:true,scopeId:issue.scopeId,issueId:issue.id,revision,notificationId,recipientId:issue.reporterId,readAt:'2026-10-05T10:00:00Z'})});
 const input={id:issue.id,revision:issue.revision};assert.equal((await followUp.get(user,input)).admission,'not_admitted');
 const consumer=createSupportResolutionConsumer({support,store,consumerId:'resolution-follow-up',resolveActor:()=>engineer});assert.deepEqual((await consumer.tick()).failed,[]);
 assert.equal((await followUp.get(user,input)).delivery,'pending');await notifications.tick();assert.equal((await followUp.get(user,input)).read,'not_verified');
 assert.equal((await followUp.recordRead(engineer,{...input,evidenceId:'fixture-channel-read'})).read,'read');
 await support.update(user,{id:issue.id,expectedRevision:issue.revision,state:'reopened',message:'Still failing'});assert.equal((await followUp.get(user,input)).historical,true);
 console.log(JSON.stringify({example:'core-support-follow-up',observation:'candidate',sourceDeduplicated:true,admissionDeliveryReadSeparated:true,reopenHistorical:true,evidence:'synthetic-host-ports-real-postgres',productionAcceptance:false}));
}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
