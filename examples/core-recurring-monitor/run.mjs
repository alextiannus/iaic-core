import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Pool} from 'pg';
import {openHost,actor,digest} from './host.mjs';
const connectionString=process.env.DATABASE_URL||process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');
const schema='monitor_example_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let host;
try{
 host=await openHost(pool);
 // Already-admitted synthetic releases; independent release examples cover the evaluation gate.
 for(const id of ['stable','candidate'])await host.releaseStore.register({manifest:{id},manifestDigest:id==='candidate'?digest:'b'.repeat(64),fixtureObservedAt:new Date(Date.now()-1000).toISOString()},actor.subjectId);
 await host.releaseStore.setChannel({name:'production',stableId:'stable',canaryId:'candidate',percentage:100,expectedRevision:0},actor.subjectId);
 const rule=await host.recurring.create(actor,{requestKey:'monitor',firstAt:new Date(Date.now()-1000).toISOString(),intervalSeconds:60,occurrenceCount:1,input:{capability:'platform.observe',input:{channel:'production'}}});
 await host.runtime.stop();host=null;
 for(const phase of ['admit','execute']){
  const result=spawnSync(process.execPath,[new URL('./worker.mjs',import.meta.url).pathname,phase],{env:{...process.env,DATABASE_URL:connectionString,IAIC_MONITOR_SCHEMA:schema},encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr||result.stdout||String(result.error));
 }
 host=await openHost(pool);
 const restored=await host.recurring.get(actor,rule.id),intent=await host.deferred.get(actor,restored.lastIntentId),tasks=await host.tasks.list(actor);
 assert.equal(tasks.length,1);assert.equal(tasks[0].id,intent.taskId);assert.equal(tasks[0].status,'succeeded');
 assert.equal(intent.requestKey,`recurring:${rule.id}:0`);assert.equal(tasks[0].request_key,`deferred:${intent.id}`);
 assert.equal((await host.tasks.history(actor,tasks[0].id)).calls.length,1);assert.equal((await host.releaseStore.history()).filter(e=>e.action==='rollback').length,1);
 console.log(JSON.stringify({example:'core-recurring-monitor',status:'passed',separateProcesses:2,lostAdmissionRecovered:true,recurringDeferredRuntime:true,originalTasks:1,monitorCalls:1,rollbacks:1,modelMode:'deterministic',productionDeployed:false}));
}finally{await host?.runtime.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
