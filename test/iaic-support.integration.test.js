import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {PostgresSupportStore} from '../support/store.js';
import {SupportIssues} from '../support/service.js';
import {createSupportCapabilities} from '../support/capabilities.js';
import {CapabilityDispatcher} from '../capabilities/index.js';
import {PostgresNotificationStore} from '../notifications/store.js';
import {Notifications} from '../notifications/service.js';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
test('support persists isolated reports, fenced lifecycle, verified resolution and original-recipient notification',{skip:!url},async()=>{
 const pool=new pg.Pool({connectionString:url});const ns='support-'+randomUUID();
 const user={scopeId:'tenant-a',subjectId:'alice'},other={scopeId:'tenant-a',subjectId:'bob'},engineer={scopeId:'tenant-a',subjectId:'codex',engineer:true};
 const store=new PostgresSupportStore({pool,namespace:ns});await store.initialize();
 const notificationStore=new PostgresNotificationStore({pool,namespace:ns});await notificationStore.initialize();
 let verified=false,revoked=false,deliveryCount=0;
 const notifications=new Notifications({store:notificationStore,resolveScope:a=>a.scopeId,authorize:a=>a.engineer===true&&!revoked,resolveDelivery:async()=>({allowed:true,send:async()=>{deliveryCount++;return {status:'delivered'}}})});
 const open=()=>new SupportIssues({store,resolveIdentity:async a=>a,authorize:async(a,{action})=>!revoked&&(!['manage','notify'].includes(action)||a.engineer===true),resolveResolution:async(id,{issue})=>({confirmed:verified,scopeId:issue.scopeId,issueId:issue.id,revision:issue.revision,deployed:true,healthy:true,regressionPassed:true,releaseId:'release-new',verificationId:id}),notifications,notificationActor:async({actor})=>actor});
 try {
  let service=open();
  const input={requestKey:'report-1',summary:'Menu publication fails',errorCode:'CAPABILITY_FAILED'};
  const [a,b]=await Promise.all([service.report(user,input),service.report(user,input)]);assert.equal(a.id,b.id);
  await assert.rejects(service.report(user,{...input,summary:'different'}),{code:'SUPPORT_REQUEST_CONFLICT'});
  assert.equal((await service.get(user,{id:a.id})).history.length,1);
  await assert.rejects(service.get(other,{id:a.id}),{code:'SUPPORT_NOT_FOUND'});
  await assert.rejects(service.get({...user,scopeId:'tenant-b'},{id:a.id}),{code:'SUPPORT_NOT_FOUND'});
  assert.deepEqual(await service.list(other),[]);
  await assert.rejects(service.queue(user),{code:'SUPPORT_ACCESS_DENIED'});
  assert.equal((await service.queue(engineer)).length,1);
  await assert.rejects(service.update(user,{id:a.id,expectedRevision:1,state:'triaged',message:'I am admin'}),{code:'SUPPORT_ACCESS_DENIED'});
  const changes=await Promise.allSettled([1,2].map(()=>service.update(engineer,{id:a.id,expectedRevision:1,state:'triaged',message:'Investigating'})));
  assert.equal(changes.filter(r=>r.status==='fulfilled').length,1);
  service=open();assert.equal((await service.get(user,{id:a.id})).state,'triaged');
  await service.update(engineer,{id:a.id,expectedRevision:2,state:'fixing',message:'Fix in progress'});
  await assert.rejects(service.update(engineer,{id:a.id,expectedRevision:3,state:'resolved',message:'Trust me',evidenceId:'fake'}),{code:'SUPPORT_RESOLUTION_UNVERIFIED'});
  await service.update(engineer,{id:a.id,expectedRevision:3,state:'verifying',message:'Testing'});
  verified=true;
  await service.update(engineer,{id:a.id,expectedRevision:4,state:'resolved',message:'Fix verified on live release',evidenceId:'regression-1'});
  const notified=await service.notify(engineer,{id:a.id,revision:5});assert.equal(notified.recipientId,'alice');assert.equal(notified.state,'pending');
  assert.equal((await service.notify(engineer,{id:a.id,revision:5})).id,notified.id);
  assert.equal((await notifications.tick()).state,'delivered');assert.equal(await notifications.tick(),null);assert.equal(deliveryCount,1);
  await service.update(user,{id:a.id,expectedRevision:5,state:'reopened',message:'Still fails for my menu'});
  assert.equal((await service.get(user,{id:a.id})).history.length,6);
  revoked=true;await assert.rejects(service.get(engineer,{id:a.id}),{code:'SUPPORT_ACCESS_DENIED'});
 }finally{await pool.query('DELETE FROM iaic_notification_attempts WHERE notification_id IN(SELECT id FROM iaic_notifications WHERE namespace=$1)',[ns]);await pool.query('DELETE FROM iaic_notifications WHERE namespace=$1',[ns]);await pool.query('DELETE FROM iaic_support_events WHERE namespace=$1',[ns]);await pool.query('DELETE FROM iaic_support_issues WHERE namespace=$1',[ns]);await pool.end();}
});
test('support capabilities reject caller supplied principals and resolution verdicts before invocation',async()=>{
 let called=false;const support={report:()=>{called=true;return {}},update:()=>{called=true;return {}}};
 const dispatcher=new CapabilityDispatcher({capabilities:createSupportCapabilities({support})});
 await assert.rejects(dispatcher.invoke('support.report',{requestKey:'x',summary:'x',reporterId:'victim'},{actor:{scopeId:'a',subjectId:'b'}}));
 await assert.rejects(dispatcher.invoke('support.update',{id:randomUUID(),expectedRevision:1,state:'resolved',message:'fixed',confirmed:true},{actor:{scopeId:'a',subjectId:'b'}}));assert.equal(called,false);
});

test('support pagination reaches every report without widening reporter or tenant scope',{skip:!url},async()=>{
 const pool=new pg.Pool({connectionString:url}),ns='support-pages-'+randomUUID();
 const store=new PostgresSupportStore({pool,namespace:ns});await store.initialize();
 const service=new SupportIssues({store,resolveIdentity:a=>a,authorize:(a,{action})=>action!=='manage'||a.engineer===true});
 const alice={scopeId:'a',subjectId:'alice'},bob={scopeId:'a',subjectId:'bob'},engineer={scopeId:'a',subjectId:'engineer',engineer:true};
 try{
  const expected=[];for(let i=0;i<105;i++)expected.push((await service.report(alice,{requestKey:String(i),summary:'Problem '+i})).id);
  const other=await service.report(bob,{requestKey:'other',summary:'Private report'});
  await service.report({...alice,scopeId:'b'},{requestKey:'other',summary:'Other tenant'});
  const scan=async(actor,operation)=>{const ids=[];let afterId;for(;;){const page=await service[operation](actor,{limit:50,afterId});ids.push(...page.map(x=>x.id));if(page.length<50)return ids;afterId=page.at(-1).id;}};
  assert.deepEqual((await scan(alice,'list')).sort(),expected.sort());
  assert.deepEqual((await scan(engineer,'queue')).sort(),[...expected,other.id].sort());
  await assert.rejects(service.list(alice,{afterId:'invalid'}),{code:'SUPPORT_INVALID_ID'});
  await assert.rejects(service.queue(alice,{afterId:other.id}),{code:'SUPPORT_ACCESS_DENIED'});
 }finally{await pool.query('DELETE FROM iaic_support_events WHERE namespace=$1',[ns]);await pool.query('DELETE FROM iaic_support_issues WHERE namespace=$1',[ns]);await pool.end();}
});
test('support notification rechecks revoked authority after resolving the sender',async()=>{
 const actor={scopeId:'a',subjectId:'engineer'},id=randomUUID();let revoked=false,enqueued=false;
 const service=new SupportIssues({store:{get:async()=>({id,scopeId:'a',reporterId:'alice'}),history:async()=>[{revision:1,state:'received',message:'Received'}]},resolveIdentity:a=>a,authorize:()=>!revoked,notificationActor:async()=>{revoked=true;return actor},notifications:{enqueue:async()=>{enqueued=true}}});
 await assert.rejects(service.notify(actor,{id,revision:1}),{code:'SUPPORT_ACCESS_DENIED'});assert.equal(enqueued,false);
});

test('support event consumer retries interrupted delivery and isolates consumer acknowledgements',{skip:!url},async()=>{
 const {SupportEventConsumer}=await import('../support/consumer.js');
 const pool=new pg.Pool({connectionString:url}),ns='support-events-'+randomUUID();
 const store=new PostgresSupportStore({pool,namespace:ns});await store.initialize();
 try{
  const issue=await store.create('a','alice',{requestKey:'one',report:{summary:'failure'}});
  let fail=true;const effects=new Set();
  const consumer=new SupportEventConsumer({store,consumerId:'inbox',deliver:async e=>{effects.add(e.requestKey);if(fail)throw Error('Lost acknowledgement');}});
  assert.equal((await consumer.tick()).failed.length,1);assert.equal((await store.pendingEvents('inbox')).length,1);
  fail=false;assert.equal((await consumer.tick()).acknowledged,1);assert.equal(effects.size,1);
  assert.equal((await consumer.tick()).acknowledged,0);assert.equal((await store.pendingEvents('engineering')).length,1);
  await store.change('a',issue.id,{expectedRevision:1,state:'triaged',message:'Investigating',actorId:'engineer'});
  assert.equal((await store.pendingEvents('inbox'))[0].revision,2);
  await assert.rejects(store.pendingEvents('inbox',{limit:101}),{code:'SUPPORT_INVALID_LIMIT'});
 }finally{await pool.query('DELETE FROM iaic_support_event_receipts WHERE namespace=$1',[ns]);await pool.query('DELETE FROM iaic_support_events WHERE namespace=$1',[ns]);await pool.query('DELETE FROM iaic_support_issues WHERE namespace=$1',[ns]);await pool.end();}
});
