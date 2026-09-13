import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {EventStore,PostgresEventSubscriptions,EventSubscriptions,createEventSubscriptionCapabilities,CapabilityDispatcher} from '@immedi/iaic-core';
async function fixture(fn){
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');const schema='event_feed_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
 try{const events=new EventStore({pool});await events.initialize();const store=new PostgresEventSubscriptions({pool});await store.initialize();const actor={subjectId:'owner'},owner={applicationId:'app',assistantId:'job',subjectId:'owner'};let allowed=true;
 const make=()=>new EventSubscriptions({store:new PostgresEventSubscriptions({pool}),events:new EventStore({pool}),resolveScope:a=>({...owner,subjectId:a.subjectId}),authorize:()=>allowed});
 await fn({pool,actor,owner,events,store,make,deny:()=>{allowed=false;},publish:(key,data={})=>events.publish(owner,{key,data,source:{kind:'fixture'}})});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
test('Subscriptions retain scoped progress across reconstruction and allow redelivery until acknowledgement',async()=>fixture(async f=>{
 let s=f.make();const d=new CapabilityDispatcher({capabilities:createEventSubscriptionCapabilities({subscriptions:s})}),invoke=(op,input,callId)=>d.invoke('events.subscription.'+op,input,{actor:f.actor,callId});
 await invoke('subscribe',{key:'consumer',prefix:'work:'},'subscribe');await f.publish('ignored');const a=await f.publish('work:a');await f.publish('work:a');await f.publish('work:b');
 const first=await invoke('read',{key:'consumer',limit:1});assert.equal(first.items[0].id,a.id);assert.equal(first.hasMore,true);assert.equal(first.cursor,'0');
 s=f.make();assert.deepEqual(await s.read(f.actor,{key:'consumer',limit:1}),first);
 await invoke('acknowledge',{key:'consumer',expectedCursor:first.cursor,cursor:first.nextCursor},'ack');
 const next=await s.read(f.actor,{key:'consumer',limit:1});assert.equal(next.items[0].key,'work:b');assert.equal(next.hasMore,false);
 await s.acknowledge(f.actor,{key:'consumer',expectedCursor:next.cursor,cursor:next.nextCursor});
 assert.deepEqual(await s.acknowledge(f.actor,{key:'consumer',expectedCursor:first.cursor,cursor:first.nextCursor}),{key:'consumer',acknowledgedThrough:first.nextCursor});
 assert.equal((await s.read(f.actor,{key:'consumer'})).items.length,0);await f.publish('work:c');assert.equal((await s.read(f.actor,{key:'consumer'})).items[0].key,'work:c');
 await assert.rejects(s.subscribe(f.actor,{key:'consumer',prefix:'changed'}),{statusCode:409});
 await assert.rejects(s.read({subjectId:'other'},{key:'consumer'}),{statusCode:404});
 f.deny();await assert.rejects(s.read(f.actor,{key:'consumer'}),{statusCode:403});await assert.rejects(s.acknowledge(f.actor,{key:'consumer',expectedCursor:next.cursor,cursor:next.nextCursor}),{statusCode:403});
}));
test('Acknowledgement rejects unobserved future/prefix cursors and concurrent checkpoints never rewind',async()=>fixture(async f=>{
 const s=f.make();await s.subscribe(f.actor,{key:'consumer',prefix:'work:'});await f.publish('work:a');await f.publish('work:b');await f.publish('other');
 const page=await s.read(f.actor,{key:'consumer'}),all=await f.events.list(f.owner);
 await assert.rejects(s.acknowledge(f.actor,{key:'consumer',expectedCursor:'0',cursor:all.nextCursor}),{statusCode:409});
 await assert.rejects(s.acknowledge(f.actor,{key:'consumer',expectedCursor:'0',cursor:'9223372036854775808'}),{statusCode:400});
 const results=await Promise.allSettled(page.items.map(e=>s.acknowledge(f.actor,{key:'consumer',expectedCursor:'0',cursor:e.sequence})));
 assert.ok(results.some(r=>r.status==='fulfilled'));const state=await f.store.read(f.owner,{key:'consumer'});
 if(state.cursor!==page.nextCursor)await s.acknowledge(f.actor,{key:'consumer',expectedCursor:state.cursor,cursor:page.nextCursor});
 await s.acknowledge(f.actor,{key:'consumer',expectedCursor:'0',cursor:page.items[0].sequence});assert.equal((await f.store.read(f.owner,{key:'consumer'})).cursor,page.nextCursor);
}));
test('A late publisher commit cannot be skipped by a later sequence in the same scope',async()=>fixture(async f=>{
 let reached,release,attempted;const atInsert=new Promise(r=>{reached=r;}),gate=new Promise(r=>{release=r;}),atSecondLock=new Promise(r=>{attempted=r;});let connects=0;
 const wrapped={connect:async()=>{const c=await f.pool.connect(),number=++connects;return {release:()=>c.release(),query:async(...args)=>{if(number===2&&String(args[0]).includes('pg_advisory_xact_lock'))attempted();const result=await c.query(...args);if(number===1&&String(args[0]).startsWith('INSERT INTO iaic_events')){reached();await gate;}return result;}};}};
 const store=new EventStore({pool:wrapped});let first,second;
 try{first=store.publish(f.owner,{key:'slow',data:{},source:{kind:'fixture'}});await atInsert;second=store.publish(f.owner,{key:'later',data:{},source:{kind:'fixture'}});await atSecondLock;
  assert.deepEqual((await f.events.list(f.owner)).items,[]);release();await Promise.all([first,second]);
  const page=await f.events.list(f.owner,{limit:1});assert.equal(page.items[0].key,'slow');assert.equal((await f.events.list(f.owner,{after:page.nextCursor})).items[0].key,'later');
 }finally{release();await Promise.allSettled([first,second].filter(Boolean));}
}));
test('Current event digest and read authority are checked before returning subscription data',async()=>fixture(async f=>{
 const s=f.make();await s.subscribe(f.actor,{key:'consumer'});const e=await f.publish('one');
 const original=s.events.list.bind(s.events);s.events.list=async(...a)=>{const page=await original(...a);f.deny();return page;};await assert.rejects(s.read(f.actor,{key:'consumer'}),{statusCode:403});
 await f.pool.query('UPDATE iaic_events SET data=$2 WHERE id=$1',[e.id,{changed:true}]);await assert.rejects(f.events.list(f.owner),{statusCode:409});
}));
test('Legacy event receipts survive sequence migration and replay without duplicate feed items',async()=>fixture(async f=>{
 const {eventDigest}=await import('@immedi/iaic-core/events/store.js');
 await f.pool.query('ALTER TABLE iaic_events DROP COLUMN event_sequence CASCADE');
 const id=randomUUID(),data={legacy:true},source={kind:'fixture'},digest=eventDigest(data,source);
 await f.pool.query('INSERT INTO iaic_events(id,application_id,assistant_id,subject_id,event_key,data,source,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,f.owner.applicationId,f.owner.assistantId,f.owner.subjectId,'legacy',data,source,digest]);
 await f.events.initialize();await f.events.initialize();
 const event=await f.events.publish(f.owner,{key:'legacy',data,source});assert.equal(event.id,id);assert.equal(event.digest,digest);
 const page=await f.events.list(f.owner);assert.equal(page.items.length,1);assert.equal(page.items[0].id,id);assert.ok(BigInt(page.nextCursor)>0n);
}));
test('Subscription write history revalidates current authority without repeating mutations',async()=>fixture(async f=>{
 const s=f.make(),caps=createEventSubscriptionCapabilities({subscriptions:s}),d=new CapabilityDispatcher({capabilities:caps});
 const input={key:'consumer'};await d.invoke(caps[0].name,input,{actor:f.actor,callId:'subscribe'});await f.publish('one');const page=await s.read(f.actor,input),ack={key:'consumer',expectedCursor:'0',cursor:page.nextCursor};
 await d.invoke(caps[2].name,ack,{actor:f.actor,callId:'ack'});
 s.store.subscribe=()=>{throw new Error('History must not subscribe again');};s.store.advance=()=>{throw new Error('History must not advance again');};
 assert.equal((await caps[0].revalidate(input,{}, {actor:f.actor})).cursor,page.nextCursor);
 assert.deepEqual(await caps[2].revalidate(ack,{}, {actor:f.actor}),{key:'consumer',acknowledgedThrough:page.nextCursor});
 f.deny();await assert.rejects(caps[2].revalidate(ack,{}, {actor:f.actor}),{statusCode:403});
}));
