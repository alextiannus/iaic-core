import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {AgentRuntime,TaskStore,ContextAssembler,CapabilityDispatcher,defineCapability,PostgresWorkspaceStore,AssistantWorkspace,TaskPlans,createTaskPlanCapabilities} from '@immedi/iaic-core';
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL;
if(!connectionString)throw new Error('Isolated PostgreSQL required');
const admin=new Pool({connectionString}),schema='task_plans_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let runtime;
try{
 await pool.query('CREATE TABLE effects(id text PRIMARY KEY, value integer)');
 const actor={subjectId:'owner',scopeId:'fixture'};let allowed=true,verifications=0;
 const authorize=a=>allowed&&a.subjectId===actor.subjectId&&a.scopeId===actor.scopeId;
 const workspaceStore=new PostgresWorkspaceStore({pool});await workspaceStore.initialize();
 const workspace=new AssistantWorkspace({store:workspaceStore,resolveScope:async a=>{if(!authorize(a))throw Object.assign(new Error('Denied'),{statusCode:403});return {applicationId:a.scopeId,assistantId:'planner',subjectId:a.subjectId};},sourceFor:()=>({kind:'agent-working-plan'})});
 const steps=(write,verify)=>[{id:'write',description:'Create one record',status:write},{id:'verify',description:'Read the original record',status:verify}];
 let plans,dispatcher;
 const open=async()=>{
  plans=new TaskPlans({workspace,readTask:(a,id)=>runtime.state(a,id)});
  const write=defineCapability({name:'record.write',description:'Create fixture record',input:{type:'object'},output:{type:'object'},effect:'write',retry:'never-replay',authorize,revalidate:async(_i,r)=>r,implementation:{kind:'function',execute:async(_i,c)=>{await pool.query('INSERT INTO effects VALUES($1,42)',[c.callId]);return {id:c.callId};}}});
  const read=defineCapability({name:'record.read',description:'Read original record',input:{type:'object',properties:{id:{type:'string'}},required:['id']},output:{type:'object'},effect:'read',authorize,revalidate:async i=>(await pool.query('SELECT * FROM effects WHERE id=$1',[i.id])).rows[0],implementation:{kind:'function',execute:async i=>(await pool.query('SELECT * FROM effects WHERE id=$1',[i.id])).rows[0]}});
  const planTools=createTaskPlanCapabilities({plans,authorize});
  const agent=defineCapability({name:'agent.work',description:'Plan and verify one record',input:{type:'object'},output:{type:'object'},effect:'read',authorize,implementation:{kind:'agent',instructions:'Use plans when useful; verify actual effects',tools:[write.name,read.name,...planTools.map(c=>c.name)],verify:async(_i,_r,{history})=>{verifications++;return Number((await pool.query('SELECT count(*) FROM effects')).rows[0].count)===1&&history.calls.some(c=>c.capability===read.name&&c.status==='succeeded'&&c.result.value===42);}}});
  dispatcher=new CapabilityDispatcher({capabilities:[write,read,...planTools,agent]});
  const model={name:'scripted-planner',next:async({messages})=>{
   const data=JSON.parse(messages.find(m=>m.role==='user').content),plan=data.plan;
   const update=value=>({type:'call',name:'tasks.plan.update',input:{id:plan.taskId,expectedRevision:plan.revision,steps:value}});
   const rejected=data.events.some(e=>e.kind==='verification'&&!e.data.verified);
   switch(data.calls.length){
    case 0:return update(steps('done','done')); // A plan claim cannot prove success.
    case 1:return rejected?update(steps('pending','pending')):{type:'finish',result:{done:true}};
    case 2:return {type:'call',name:write.name,input:{}};
    case 3:return update(steps('done','in_progress'));
    case 4:
     assert.equal(plan.revision,3);assert.equal(plan.steps[0].status,'done');
     if(!data.events.some(e=>e.kind==='input'))return {type:'wait',question:'Continue readback?'};
     return {type:'call',name:read.name,input:{id:data.calls.find(c=>c.capability===write.name).result.id}};
    case 5:return update(steps('done','done'));
    default:return {type:'finish',result:{done:true}};
   }
  }};
  runtime=new AgentRuntime({store:new TaskStore({pool}),dispatcher,model,version:'plans-v1',maxTurns:12,maxCalls:10,context:new ContextAssembler({planProvider:({actor,task})=>plans.read(actor,{id:task.id})})});dispatcher.tasks=runtime;await runtime.initialize();return agent;
 };
 const cap=await open();const task=await runtime.create({actor,capability:cap,input:{goal:'Create and verify one record'},idempotencyKey:'original'});
 assert.equal((await runtime.tick()).waiting_reason,'input');assert.equal(verifications,1);
 assert.equal((await plans.read(actor,{id:task.id})).revision,3);await runtime.stop();await open();
 // Shared Capability readers see the same durable plan after reconstruction.
 assert.equal((await dispatcher.invoke('tasks.plan.read',{id:task.id},{actor})).steps[0].status,'done');
 allowed=false;await assert.rejects(dispatcher.invoke('tasks.plan.read',{id:task.id},{actor}),{statusCode:403});allowed=true;
 await runtime.transition(actor,task.id,{action:'provide_input',input:'Continue',requestKey:'confirm'});
 assert.equal((await runtime.tick()).status,'succeeded');assert.equal(verifications,2);
 const saved=await plans.read(actor,{id:task.id});assert.equal(saved.revision,4);assert.ok(saved.steps.every(s=>s.status==='done'));
 const history=await runtime.store.history(actor,task.id);assert.equal(history.calls.filter(c=>c.capability==='record.write').length,1);assert.equal((await pool.query('SELECT * FROM effects')).rowCount,1);
 await assert.rejects(plans.update(actor,{id:task.id,expectedRevision:4,steps:[]}),{statusCode:409});
 console.log(JSON.stringify({example:'core-task-plans',status:'passed',runtimeReconstructed:true,currentPlanRestored:true,unverifiedDoneClaimRejected:true,oneBusinessEffect:true,sharedCapabilityRead:true,currentRevocation:true,terminalPlanWriteRejected:true,actualModel:false}));
}finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
