import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID,randomBytes,createHmac} from 'node:crypto';import {createServer} from 'node:http';import {Pool} from 'pg';
import {EventStore,AssistantEvents,HmacEventIngress,createHmacEventHandler,eventSigningBytes,WEBHOOK_EVENT_PREFIX,EventTriggers,DeferredTaskStore,DeferredTasks,TaskStore} from '@immedi/iaic-core';
const scope={applicationId:'inbox',assistantId:'helper',subjectId:'owner'},actor={scopeId:'inbox',subjectId:'owner'};
async function fixture(run){
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;assert.ok(connectionString);const schema='webhook_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
 try{const store=new EventStore({pool});await store.initialize();const state={enabled:true,clock:Date.now()},secret=randomBytes(32);
 const ingress=new HmacEventIngress({store,now:()=>state.clock,resolveEndpoint:async({endpointId,keyId})=>endpointId==='source'&&['current','rotated'].includes(keyId)?{enabled:state.enabled,scope,secret}:null});
 const sign=(extra={})=>{const e={endpointId:'source',keyId:'current',deliveryId:'delivery',timestamp:String(state.clock),body:Buffer.from('{"recordId":"R-1"}'),...extra};return {...e,signature:'sha256='+createHmac('sha256',secret).update(eventSigningBytes(e)).digest('hex')};};
 await run({pool,store,ingress,state,sign});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
test('Signed delivery preserves original provenance across retry, key rotation and service reconstruction',()=>fixture(async({store,ingress,state,sign})=>{
 const first=await ingress.accept(sign());const second=await ingress.accept(sign({keyId:'rotated',timestamp:String(state.clock+1)}));assert.equal(second.id,first.id);assert.equal(second.source.keyId,'current');
 assert.equal((await new EventStore({pool:store.pool}).read(scope,{key:first.key})).digest,first.digest);
 await assert.rejects(ingress.accept(sign({body:Buffer.from('{"recordId":"changed"}')})),{statusCode:409});
 const events=new AssistantEvents({store,resolveScope:()=>scope,sourceFor:()=>({kind:'user-event'}),reservedPrefixes:[WEBHOOK_EVENT_PREFIX]});await assert.rejects(events.publish(actor,{key:first.key,data:{recordId:'R-1'}}),{statusCode:403});
 await store.publish(scope,{key:WEBHOOK_EVENT_PREFIX+'source:occupied',data:{recordId:'R-1'},source:{kind:'user-event'}});await assert.rejects(ingress.accept(sign({deliveryId:'occupied'})),{statusCode:409});
}));
test('Invalid signature, stale/future delivery, disabled source and non-JSON bytes never publish',()=>fixture(async({store,ingress,state,sign})=>{
 const valid=sign();await assert.rejects(ingress.accept({...valid,body:Buffer.from('{"recordId":"tampered"}')}),{statusCode:401});
 await assert.rejects(ingress.accept(sign({timestamp:String(state.clock-300001)})),{statusCode:401});await assert.rejects(ingress.accept(sign({timestamp:String(state.clock+30001)})),{statusCode:401});
 state.enabled=false;await assert.rejects(ingress.accept(valid),{statusCode:401});state.enabled=true;
 await assert.rejects(ingress.accept(sign({body:Buffer.from([0xff])})),{statusCode:400});await assert.rejects(ingress.accept(sign({body:Buffer.from('[]')})),{statusCode:400});
 await assert.rejects(store.read(scope,{key:WEBHOOK_EVENT_PREFIX+'source:delivery'}),{statusCode:404});
}));
test('HTTP ingress validates exact bytes and returns bounded receipts without event content',()=>fixture(async({ingress,sign})=>{
 const server=createServer(createHmacEventHandler({ingress,endpointId:'source'}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const url=`http://127.0.0.1:${server.address().port}`,signed=sign();const headers={'content-type':'application/json','x-iaic-key-id':signed.keyId,'x-iaic-delivery-id':signed.deliveryId,'x-iaic-timestamp':signed.timestamp,'x-iaic-signature':signed.signature};
 const response=await fetch(url,{method:'POST',headers,body:signed.body});assert.equal(response.status,200);const receipt=await response.json();assert.deepEqual(Object.keys(receipt).sort(),['digest','id','key','publishedAt']);
 assert.equal((await fetch(url)).status,405);assert.equal((await fetch(url,{method:'POST',headers,body:Buffer.alloc(8001,32)})).status,413);
 assert.equal((await fetch(url,{method:'POST',headers,body:'{}'})).status,401);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}));
test('Authenticated event wakes the original deferred trigger once and retains its event receipt',()=>fixture(async({pool,store,ingress,sign})=>{
 const tasks=new TaskStore({pool}),deferredStore=new DeferredTaskStore({pool});await tasks.initialize();await deferredStore.initialize();
 const triggers=new EventTriggers({readEvent:(a,key)=>store.read(scope,{key}),authorizeEvent:a=>a.subjectId===actor.subjectId});
 const ports={store:deferredStore,triggers,resolveScope:()=>scope,restoreActor:()=>actor,validateInput:()=>{},findTask:(a,key)=>tasks.findRequest(a,'react',key),startTask:(a,input,key)=>tasks.create({actor:a,capability:'react',input,idempotencyKey:key,version:'fixture',model:'fixture'})};
 const deferred=new DeferredTasks(ports),key=WEBHOOK_EVENT_PREFIX+'source:delivery';const intent=await triggers.followUp(deferred,actor,{requestKey:'react-once',trigger:{kind:'event',key},input:{goal:'Check the authoritative record referenced by the signal'}});
 assert.equal((await deferred.tick()).state,'queued');assert.equal((await tasks.list(actor)).length,0);
 const event=await ingress.accept(sign());await ingress.accept(sign());await pool.query('UPDATE iaic_deferred_tasks SET next_attempt_at=now() WHERE id=$1',[intent.id]);
 const matched=await new DeferredTasks(ports).tick();assert.equal(matched.state,'dispatched');assert.equal(matched.triggerReceipt.eventId,event.id);assert.equal(matched.triggerReceipt.digest,event.digest);assert.equal((await tasks.get(actor,matched.taskId)).input.sourceEventKey,key);
 assert.equal(await deferred.tick(),null);assert.equal((await tasks.list(actor)).length,1);
}));
