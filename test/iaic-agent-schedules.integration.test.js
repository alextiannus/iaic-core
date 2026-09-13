import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {openHost,actor} from '../examples/core-recurring-monitor/host.mjs';
async function fixture(run){
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;assert.ok(connectionString);const schema='agent_schedules_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let host,allowed=true;
 try{host=await openHost(pool,{allowed:()=>allowed});await run(host,()=>{allowed=false;});}finally{await host?.runtime.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
const input={capability:'platform.observe',input:{channel:'production'}},dueAt=()=>new Date(Date.now()-1000).toISOString();
test('Agent scheduling rejects unregistered/function capabilities, malformed input, foreign actors and internal occurrence keys',()=>fixture(async host=>{
 const schedule=envelope=>host.deferred.schedule(actor,{requestKey:randomUUID(),dueAt:dueAt(),input:envelope});
 await assert.rejects(schedule({capability:'observation.monitor',input:{channel:'production'}}),{statusCode:404});
 await assert.rejects(schedule({capability:'missing',input:{}}),{statusCode:404});
 await assert.rejects(schedule({...input,input:{channel:'unapproved'}}),{statusCode:400});
 await assert.rejects(schedule({...input,autoProtect:true}),{statusCode:400});
 await assert.rejects(host.deferred.schedule({...actor,subjectId:'other'},{requestKey:'foreign',dueAt:dueAt(),input}),{statusCode:403});
 await assert.rejects(host.deferred.schedule(actor,{requestKey:'recurring:occupied',dueAt:dueAt(),input}),{statusCode:400});
 assert.equal((await host.deferred.list(actor)).items.length,0);
}));
test('Revocation after scheduling blocks future Task admission without inference or effects',()=>fixture(async(host,revoke)=>{
 await host.deferred.schedule(actor,{requestKey:'one',dueAt:dueAt(),input});
 revoke();const blocked=await host.deferred.tick();assert.equal(blocked.state,'blocked');assert.equal(blocked.taskId,null);assert.equal((await host.tasks.list(actor)).length,0);
}));
