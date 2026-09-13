import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {TaskStore,TaskListing,createTaskListCapability,CapabilityDispatcher} from '@immedi/iaic-core';
const url=process.env.SUBMISSION_TEST_DATABASE_URL,actor={scopeId:'listing-app',subjectId:'owner'},key=Buffer.alloc(32,7);
async function fixture(run){const schema='task_listing_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:url});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});try{const store=new TaskStore({pool});await store.initialize();const ids=[];for(let i=0;i<75;i++){const task=await store.create({actor,capability:i%2?'work.other':'work.run',input:{private:'not public'},idempotencyKey:'task-'+i,version:'v1',model:'fixture'});ids.push(task.id);}await pool.query("UPDATE iaic_tasks SET created_at='2026-09-14T00:00:00.123456Z'");const make=(readTask=(actor,id)=>store.get(actor,id),cursorKey=key)=>new TaskListing({store,readTask,resolveOwner:a=>JSON.stringify([a.scopeId,a.subjectId]),cursorKey});await run({store,pool,ids,make});}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}}
test('Task pages enumerate older Tasks with microsecond ties and resume across reconstruction',{skip:!url},async()=>fixture(async({store,pool,ids,make})=>{
 let listing=make(),page=await listing.list(actor,{limit:7}),seen=page.items.map(row=>row.id);assert.equal(page.items[0].input,undefined);
 const newer=await store.create({actor,capability:'work.run',input:{},idempotencyKey:'newer',version:'v1',model:'fixture'});await pool.query("UPDATE iaic_tasks SET created_at='2026-09-14T00:00:01.123456Z' WHERE id=$1",[newer.id]);listing=make();
 while(page.nextCursor){page=await listing.list(actor,{limit:11,cursor:page.nextCursor});seen.push(...page.items.map(row=>row.id));}
 assert.equal(new Set(seen).size,75);assert.deepEqual([...seen].sort(),ids.sort());
 const filtered=await listing.list(actor,{capability:'work.other',status:'queued',limit:100});assert.equal(filtered.items.length,37);assert.equal(filtered.nextCursor,null);
 assert.equal((await pool.query("SELECT count(*) FROM iaic_tasks WHERE created_at='2026-09-14T00:00:00.123456Z'")).rows[0].count,'75');
}));
test('Task cursors bind owner and filters, hide denied positions and reject tampering',{skip:!url},async()=>fixture(async({store,make})=>{
 let denied=true;const listing=make(async(a,id)=>{if(denied)throw Object.assign(new Error('Revoked'),{statusCode:403});return store.get(a,id);});
 const empty=await listing.list(actor,{limit:5,capability:'work.run'});assert.deepEqual(empty.items,[]);assert.ok(empty.nextCursor);
 assert.equal(Buffer.from(empty.nextCursor,'base64url').includes(Buffer.from('work.run')),false);
 await assert.rejects(listing.list({...actor,subjectId:'other'},{limit:5,capability:'work.run',cursor:empty.nextCursor}),{statusCode:400});
 await assert.rejects(listing.list(actor,{limit:5,capability:'work.other',cursor:empty.nextCursor}),{statusCode:400});
 const bytes=Buffer.from(empty.nextCursor,'base64url');bytes[15]^=1;await assert.rejects(listing.list(actor,{capability:'work.run',cursor:bytes.toString('base64url')}),{statusCode:400});
 await assert.rejects(make(undefined,Buffer.alloc(32,8)).list(actor,{capability:'work.run',cursor:empty.nextCursor}),{statusCode:400});
 denied=false;const next=await listing.list(actor,{limit:5,capability:'work.run',cursor:empty.nextCursor});assert.equal(next.items.length,5);
 const dispatcher=new CapabilityDispatcher({capabilities:[createTaskListCapability({listing,authorize:()=>true})]});assert.equal((await dispatcher.invoke('tasks.list',{limit:2},{actor})).items.length,2);
 denied=true;const capability=dispatcher.capabilities.get('tasks.list');assert.deepEqual((await capability.revalidate({limit:2},{},{actor})).items,[]);
}));
test('Task listing propagates service failures and checks state filters again after lookup',{skip:!url},async()=>fixture(async({store,make})=>{
 await assert.rejects(make(async()=>{throw Object.assign(new Error('Unavailable'),{statusCode:503});}).list(actor,{}),{statusCode:503});
 const listing=make(async(a,id)=>({...await store.get(a,id),status:'cancelled'}));assert.deepEqual((await listing.list(actor,{status:'queued',limit:2})).items,[]);
 await assert.rejects(listing.list(actor,{limit:101}),{statusCode:400});assert.throws(()=>new TaskListing({store,readTask:()=>{},resolveOwner:()=>'',cursorKey:Buffer.alloc(4)}));
}));
