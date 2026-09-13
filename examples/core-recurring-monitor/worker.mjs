import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {openHost} from './host.mjs';
const pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${process.env.IAIC_MONITOR_SCHEMA}`});let host;
try{
 host=await openHost(pool,{loseAdmissionResponse:process.argv[2]==='admit'});
 if(process.argv[2]==='admit'){
  assert.equal((await host.recurring.tick()).state,'completed');
  assert.equal((await host.deferred.tick()).state,'retry');
 }else{
  assert.equal((await host.deferred.tick()).state,'dispatched');
  const task=await host.runtime.tick();if(task.status!=='succeeded')console.error(JSON.stringify({task,history:await host.tasks.history({scopeId:'monitor-example',subjectId:'platform'},task.id)}));assert.equal(task.status,'succeeded');
  assert.equal(await host.recurring.tick(),null);assert.equal(await host.deferred.tick(),null);assert.equal(await host.runtime.tick(),null);
 }
}finally{await host?.runtime.stop();await pool.end();}
