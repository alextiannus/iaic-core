import assert from 'node:assert/strict';import {randomUUID,randomBytes,createHmac} from 'node:crypto';import {Pool} from 'pg';
import {PostgresEventSubscriptions,EventSubscriptions,createEventSubscriptionCapabilities,CapabilityDispatcher,HmacEventIngress,eventSigningBytes,WEBHOOK_EVENT_PREFIX,EventStore,AssistantEvents,EventTriggers,triggerRouter,DeferredTaskStore,DeferredTasks} from '@immedi/iaic-core';
const admin=new Pool({connectionString:process.env.DATABASE_URL}),schema='event_example_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
try{
 const scope={applicationId:'neutral',assistantId:'helper',subjectId:'reader'},store=new EventStore({pool});await store.initialize();const events=new AssistantEvents({store,resolveScope:async()=>scope,sourceFor:()=>({kind:'user-event',reference:'reader'})});const triggers=new EventTriggers({authorizeEvent:actor=>events.authorize(actor),readEvent:(actor,key)=>events.read(actor,{key})});
 const deferredStore=new DeferredTaskStore({pool});await deferredStore.initialize();let starts=0;const deferred=new DeferredTasks({store:deferredStore,resolveScope:async()=>scope,restoreActor:async()=>({id:'reader'}),validateInput:async()=>{},findTask:async()=>null,startTask:async()=>{starts++;return {id:randomUUID()};},triggers:triggerRouter({event:triggers})});
 const intent=await triggers.followUp(deferred,{}, {requestKey:'follow',trigger:{kind:'event',key:'input-ready'},input:{goal:'Continue with the event data'}});assert.equal((await deferred.tick()).state,'queued');assert.equal(starts,0);
 const event=await events.publish({}, {key:'input-ready',data:{codename:'Cobalt'}});assert.equal((await events.publish({}, {key:'input-ready',data:{codename:'Cobalt'}})).id,event.id);await pool.query('UPDATE iaic_deferred_tasks SET next_attempt_at=now() WHERE id=$1',[intent.id]);const dispatched=await deferred.tick();assert.equal(dispatched.state,'dispatched');assert.equal(dispatched.triggerReceipt.eventId,event.id);assert.equal(starts,1);
 assert.equal((await new EventStore({pool}).read(scope,{key:'input-ready'})).digest,event.digest);
 const secret=randomBytes(32),ingress=new HmacEventIngress({store,resolveEndpoint:async({endpointId,keyId})=>endpointId==='partner'&&keyId==='active'?{scope,secret,enabled:true}:null});
 const envelope={endpointId:'partner',keyId:'active',deliveryId:'delivery-1',timestamp:String(Date.now()),body:Buffer.from('{"reference":"external-record"}')};
 const signed={...envelope,signature:'sha256='+createHmac('sha256',secret).update(eventSigningBytes(envelope)).digest('hex')};
 const webhook=await ingress.accept(signed);assert.equal((await ingress.accept(signed)).id,webhook.id);assert.equal(webhook.source.kind,'signed-webhook');assert.equal(webhook.key,WEBHOOK_EVENT_PREFIX+'partner:delivery-1');
 const checkpoints=new PostgresEventSubscriptions({pool});await checkpoints.initialize();
 const buildSubscription=()=>new EventSubscriptions({store:new PostgresEventSubscriptions({pool}),events:store,resolveScope:()=>scope,authorize:a=>a.subjectId==='reader'});
 const reader={subjectId:'reader'},subscriptions=buildSubscription(),capabilities=createEventSubscriptionCapabilities({subscriptions}),dispatcher=new CapabilityDispatcher({capabilities});
 await dispatcher.invoke('events.subscription.subscribe',{key:'worker',prefix:WEBHOOK_EVENT_PREFIX},{actor:reader,callId:'subscribe'});
 const page=await dispatcher.invoke('events.subscription.read',{key:'worker'},{actor:reader});assert.equal(page.items.length,1);assert.equal(page.items[0].id,webhook.id);
 assert.deepEqual(await buildSubscription().read(reader,{key:'worker'}),page);
 const ack={key:'worker',expectedCursor:page.cursor,cursor:page.nextCursor};await dispatcher.invoke('events.subscription.acknowledge',ack,{actor:reader,callId:'ack'});
 assert.equal((await buildSubscription().read(reader,{key:'worker'})).items.length,0);
 assert.equal((await capabilities.find(c=>c.name.endsWith('.acknowledge')).revalidate(ack,{}, {actor:reader})).acknowledgedThrough,page.nextCursor);
 console.log(JSON.stringify({cursorSubscription:true,reconstructedCheckpoint:true,signedWebhook:true,scopedImmutableEvent:true,waitsWithoutInference:true,durableReceipt:true,existingDispatcher:true,erpUsed:false}));
}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
