import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {PostgresInboxStore} from '@immedi/iaic-core/inbox/store.js';
import {Inbox} from '@immedi/iaic-core/inbox/service.js';
const owner={principal:'user',tenant:'tenant',workspace:'workspace',market:'market'};
const payload={requestKey:'event',notificationId:'notification',title:'Update',summary:'Private summary',category:'status',priority:'normal',relatedObjectRef:'private-object'};
async function fixture(run) {
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;assert.ok(connectionString);
 const schema='inbox_'+randomUUID().replaceAll('-','');const admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
 const store=new PostgresInboxStore({pool,namespace:'fixture'});await store.initialize();
 const resolveScope=a=>JSON.stringify([a.principal,a.tenant,a.workspace,a.market]);
 try{await run({pool,store,resolveScope});}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
test('Inbox durable dedupe, all scope dimensions, retained titles and current detail permission',async()=>fixture(async({store,resolveScope})=>{
 let allowed=true;const inbox=new Inbox({store,resolveScope,authorize:(_a,c)=>!c.item||allowed});
 const [one,two]=await Promise.all([inbox.receive(owner,payload),inbox.receive(owner,payload)]);assert.equal(one.id,two.id);
 await assert.rejects(inbox.receive(owner,{...payload,title:'changed'}),{statusCode:409});
 for(const field of Object.keys(owner)) {
  const other={...owner,[field]:'other'};assert.equal(await inbox.unreadCount(other),0);assert.equal((await inbox.list(other)).items.length,0);
  await assert.rejects(inbox.get(other,one.id),{statusCode:404});await assert.rejects(inbox.archive(other,one.id),{statusCode:404});
 }
 assert.equal(one.readAt,null);assert.ok(one.deliveredAt);assert.equal(await inbox.unreadCount(owner),1);
 assert.ok((await inbox.markRead(owner,one.id)).readAt);assert.equal(await inbox.unreadCount(owner),0);
 await inbox.markUnread(owner,one.id);assert.equal(await inbox.unreadCount(owner),1);
 allowed=false;const summary=(await inbox.list(owner)).items[0];assert.equal(summary.title,'Update');assert.equal(summary.summary,undefined);assert.equal(summary.relatedObjectRef,undefined);
 await assert.rejects(inbox.get(owner,one.id),{statusCode:403});await assert.rejects(inbox.project(owner,one.id,{kind:'conversation'}),{statusCode:403});
 allowed=true;await inbox.archive(owner,one.id);assert.equal(await inbox.unreadCount(owner),0);assert.equal((await inbox.list(owner)).items.length,0);assert.equal((await inbox.list(owner,{archived:true})).items.length,1);
 const fresh=new Inbox({store:new PostgresInboxStore({pool:store.pool,namespace:'fixture'}),resolveScope,authorize:()=>true});assert.ok((await fresh.get(owner,one.id)).archivedAt);
}));
test('Inbox cursor survives new arrivals and concurrent state changes',async()=>fixture(async({store,resolveScope})=>{
 const inbox=new Inbox({store,resolveScope,authorize:()=>true});
 const entries=[];for(let i=0;i<5;i++)entries.push(await inbox.receive(owner,{...payload,requestKey:String(i)}));
 const first=await inbox.list(owner,{limit:2});assert.equal(first.unreadCount,5);
 await Promise.all([inbox.receive(owner,{...payload,requestKey:'new'}),inbox.markRead(owner,entries[0].id),inbox.archive(owner,entries[1].id)]);
 const second=await inbox.list(owner,{limit:2,before:first.next});assert.equal(second.unreadCount,4);assert.deepEqual(second.items.map(x=>x.id),[entries[2].id,entries[0].id]);assert.equal(second.next,null);
}));
test('Unknown Task and conversation receipts reconcile without duplicate effects; ordinary items cannot create Tasks',async()=>fixture(async({store,resolveScope})=>{
 const receipts=new Map();let sends=0;
 const adapter={send:async({idempotencyKey})=>{sends++;receipts.set(idempotencyKey,'effect-'+sends);throw Error('crash after durable effect');},query:async({idempotencyKey})=>receipts.has(idempotencyKey)?{status:'delivered',reference:receipts.get(idempotencyKey)}:{status:'unknown'}};
 const inbox=new Inbox({store,resolveScope,authorize:()=>true,resolveProjection:()=>adapter});
 const ordinary=await inbox.receive(owner,payload);await assert.rejects(inbox.project(owner,ordinary.id,{kind:'task'}),{statusCode:409});
 const action=await inbox.receive(owner,{...payload,requestKey:'action',actionRef:'action-stable-key'});
 for(const [value,kind] of [[ordinary,'conversation'],[action,'task']]) {
  const first=await inbox.project(owner,value.id,{kind});assert.equal(first.state,'unknown');
  const restored=new Inbox({store,resolveScope,authorize:()=>true,resolveProjection:()=>adapter});
  assert.equal((await restored.project(owner,value.id,{kind})).state,'delivered');
  assert.equal((await restored.project(owner,value.id,{kind})).id,first.id);
 }
 assert.equal(sends,2);assert.equal((await inbox.get(owner,action.id)).readAt,null);
 assert.deepEqual((await inbox.history(owner,action.id)).map(x=>x.state),['sending','unknown','delivered']);
}));
test('Expired claim queries first; not_sent retries same effect key; concurrent workers send once',async()=>fixture(async({pool,store,resolveScope})=>{
 let sends=0,queries=0;const keys=[];
 const inbox=new Inbox({store,resolveScope,authorize:()=>true,resolveProjection:()=>({send:async c=>{sends++;keys.push(c.idempotencyKey);return {status:'delivered',reference:'receipt'};},query:async()=>{queries++;return {status:'not_sent'};}})});
 const value=await inbox.receive(owner,{...payload,actionRef:'action'});
 const claim=await store.claim(resolveScope(owner),value.id,'task','action');
 await pool.query("UPDATE iaic_inbox_projections SET lease_until=now()-interval '1 second' WHERE id=$1",[claim.projection.id]);
 assert.equal((await inbox.project(owner,value.id,{kind:'task'})).state,'not_sent');assert.equal(sends,0);assert.equal(queries,1);
 await Promise.all([inbox.project(owner,value.id,{kind:'task'}),inbox.project(owner,value.id,{kind:'task'})]);assert.equal(sends,1);assert.equal(keys[0],claim.projection.id);
 const other=await inbox.receive(owner,{...payload,requestKey:'other',actionRef:'action'});await assert.rejects(inbox.project(owner,other.id,{kind:'task'}),{statusCode:409});
}));
test('Revocation during adapter resolution prevents send and preserves a recoverable non-send receipt',async()=>fixture(async({store,resolveScope})=>{
 let allowed=true,sends=0,revoke=true;
 const inbox=new Inbox({store,resolveScope,authorize:(_a,c)=>!c.action.startsWith('project:')||allowed,resolveProjection:()=>{if(revoke)allowed=false;return {send:async()=>{sends++;return {status:'delivered',reference:'receipt'};},query:async()=>({status:'unknown'})};}});
 const value=await inbox.receive(owner,payload);
 await assert.rejects(inbox.project(owner,value.id,{kind:'conversation'}),{statusCode:403});assert.equal(sends,0);
 assert.equal((await inbox.history(owner,value.id)).at(-1).state,'not_sent');
 allowed=true;revoke=false;assert.equal((await inbox.project(owner,value.id,{kind:'conversation'})).state,'delivered');assert.equal(sends,1);
}));
