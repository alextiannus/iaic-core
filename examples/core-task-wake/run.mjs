import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {TaskStore} from '@immedi/iaic-core/tasks/store.js';
import {hostProjection} from '@immedi/iaic-core/context/host.js';
import {TaskWake} from '@immedi/iaic-core/notifications/task-wake.js';
import {PostgresNotificationStore} from '@immedi/iaic-core/notifications/store.js';
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL;assert.ok(connectionString);
const schema='wake_example_'+randomUUID().replaceAll('-','');const admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
try {
 const actor={scopeId:'tenant:workspace:market',subjectId:'user'};
 const tasks=new TaskStore({pool}),store=new PostgresNotificationStore({pool,namespace:'example'});await tasks.initialize();await store.initialize();
 await pool.query('CREATE TABLE host_task_context_links(task_id uuid PRIMARY KEY, context jsonb NOT NULL)');
 const context={source:'host',schema:'example/workspace',version:'1',reference:'immutable-context-v1',revision:'1',digest:hostProjection({tenant:'tenant',workspace:'workspace',market:'market'}).digest,owner:actor};
 let currentSend=true,failBinding=true,admissions=0;
 const options={store,channel:'example-wake',topics:['workspace.review'],resolveScope:a=>JSON.stringify([a.scopeId,a.subjectId]),authorizeEnqueue:()=>true,authorizeSend:()=>currentSend,authorizeReconcile:()=>true,
  admitTask:async({intent,idempotencyKey})=>{admissions++;const task=await tasks.create({actor:intent.target,capability:intent.capability,input:intent.input,idempotencyKey,version:'wake-example-v1',model:'fixture',trustedContext:intent.context});return {...task,owner:tasks.actor(task)};},
  findTask:async({intent,idempotencyKey})=>{const task=await tasks.findRequest(intent.target,intent.capability,idempotencyKey);return task?{status:'found',task:{...task,owner:tasks.actor(task)}}:{status:'unknown'};},
  repairBinding:async({intent,task})=>{if(failBinding)throw Error('Fixture stopped after Task commit before application link');await pool.query('INSERT INTO host_task_context_links(task_id,context) VALUES($1,$2) ON CONFLICT DO NOTHING',[task.id,intent.context]);const row=(await pool.query('SELECT context FROM host_task_context_links WHERE task_id=$1',[task.id])).rows[0];assert.deepEqual(row.context,intent.context);return {bound:true,reference:task.id};}};
 let wake=new TaskWake(options);
 const queued=await wake.enqueue(actor,{requestKey:'event-1',intent:{topic:'workspace.review',target:actor,context,capability:'assistant.review',taskRequestKey:'wake-task-1',input:{goal:'Review the workspace state'},authorityRef:'mandate-revision-1'}});
 assert.equal((await wake.pump()).results[0].state,'unknown');assert.equal((await tasks.list(actor)).length,1);
 currentSend=false;failBinding=false;wake=new TaskWake({...options,store:new PostgresNotificationStore({pool,namespace:'example'})});
 assert.equal((await wake.pump()).results[0].state,'delivered');assert.equal(admissions,1);assert.equal((await pool.query('SELECT * FROM host_task_context_links')).rowCount,1);
 const history=await store.history(queued.scopeId,queued.requestKey);assert.equal(history.length,1);assert.equal(history[0].state,'delivered');
 console.log(JSON.stringify({example:'core-task-wake',actualTaskStore:true,taskCommitBeforeBindingFailure:true,reconstructionRepairsBinding:true,revokedNewSendDoesNotBlockAuthorizedHistoryRepair:true,admissions,production:false}));
} finally {await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
