import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {actor,openDemo} from './application.mjs';
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL;assert.ok(connectionString);
const schema='inbox_demo_'+randomUUID().replaceAll('-','');const admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
try {
 let lose=true,allowed=true;let app=await openDemo(pool,{loseReceipt:()=>lose,authorized:()=>allowed});
 const {ordinary,action}=await app.seed();assert.equal((await app.tasks.list(actor)).length,0);
 assert.equal((await app.inbox.project(actor,action.id,{kind:'task'})).state,'unknown');
 lose=false;app=await openDemo(pool,{authorized:()=>allowed});
 for(const [entry,kind] of [[ordinary,'conversation'],[action,'task']])assert.equal((await app.inbox.project(actor,entry.id,{kind})).state,'delivered');
 await app.inbox.project(actor,action.id,{kind:'task'});assert.equal((await app.tasks.list(actor)).length,1);
 assert.equal((await app.sessions.read(app.sessionScope,app.session.id)).events.length,1);
 assert.equal((await app.invoke('profile.read')).name,null);
 await app.invoke('profile.configure',{name:'Example provider'});
 await app.invoke('capability.describe',{description:'I offer scheduled service visits.'});
 await assert.rejects(app.invoke('capability.publish',{reviewedDescription:'Unreviewed replacement'}),{statusCode:409});
 await app.invoke('capability.publish',{reviewedDescription:'I offer scheduled service visits.'});
 assert.equal((await app.invoke('orders.read',{id:(await app.inbox.get(actor,ordinary.id)).relatedObjectRef})).status,'submitted');
 await app.inbox.markRead(actor,ordinary.id);assert.equal(await app.inbox.unreadCount(actor),1);
 const ref={id:app.session.id,throughSequence:1};assert.equal((await app.timeline.context(actor,ref)).events[0].data.id,ordinary.id);
 allowed=false;assert.equal((await app.timeline.context(actor,ref)).events[0].data.unavailable,true);
 console.log(JSON.stringify({example:'core-inbox',status:'passed',actualCoreTaskAndSession:true,crashReceiptRecovery:true,ordinaryCreatesNoTask:true,hostBusinessFixtures:true,currentPermission:true,modelMode:'deterministic-host-fixture',production:false}));
} finally {await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
