import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {TaskPlans,createTaskPlanCapabilities,PostgresWorkspaceStore,AssistantWorkspace,CapabilityDispatcher,ContextAssembler,createAgentTaskCapabilities} from '@immedi/iaic-core';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
test('Task plans preserve Workspace CAS, scoped access and current history instead of stale plan bodies',{skip:!url},async()=>{
 const admin=new Pool({connectionString:url}),schema='plans_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
 try{
  const id=randomUUID(),other=randomUUID(),actor={subjectId:'owner',scopeId:'org'};let allowed=true;
  const store=new PostgresWorkspaceStore({pool});await store.initialize();
  const workspace=new AssistantWorkspace({store,resolveScope:a=>({applicationId:a.scopeId,assistantId:'worker',subjectId:a.subjectId}),sourceFor:()=>({kind:'agent-plan'})});
  const plans=new TaskPlans({workspace,readTask:async(a,key)=>{if(!allowed||a.subjectId!==actor.subjectId||key!==id)throw Object.assign(new Error('Denied'),{statusCode:403});return {id,status:'waiting'};}});
  const capabilities=createTaskPlanCapabilities({plans,authorize:()=>true}),dispatcher=new CapabilityDispatcher({capabilities});
  const input={id,expectedRevision:0,steps:[{id:'a',description:'Read current source',status:'pending'}]};
  assert.deepEqual((await plans.read(actor,{id})).steps,[]);
  const races=await Promise.allSettled([plans.update(actor,input),plans.update(actor,input)]);assert.equal(races.filter(r=>r.status==='fulfilled').length,1);assert.equal(races.find(r=>r.status==='rejected').reason.statusCode,409);
  const result=(await plans.read(actor,{id}));assert.equal(result.revision,1);
  await assert.rejects(dispatcher.invoke('tasks.plan.update',input,{actor,callId:randomUUID()}),e=>e.preflightRejected===true);
  await assert.rejects(plans.update(actor,{...input,expectedRevision:1},{taskId:other}),{statusCode:403});
  await assert.rejects(plans.update(actor,{...input,expectedRevision:1,steps:[input.steps[0],input.steps[0]]}),/duplicate/);
  await plans.update(actor,{...input,expectedRevision:1,steps:[{...input.steps[0],status:'done',note:'A claim only'}]});
  const context=new ContextAssembler({});
  const history={events:[],calls:[{id:randomUUID(),capability:'tasks.plan.read',input:{id},status:'succeeded',result},{id:randomUUID(),capability:'tasks.plan.update',input,status:'succeeded',result:{reference:result.reference,revision:1,taskId:id}}]};
  const refreshed=await context.revalidateHistory({history,actor,dispatcher});assert.equal(refreshed.calls[0].result.revision,2);assert.equal(refreshed.calls[1].input.steps,undefined);assert.equal(refreshed.calls[1].result.revision,1);
  assert.equal(history.calls[1].input.steps[0].status,'pending');
  const shared=createAgentTaskCapabilities({plans,workspace,memory:{},authorize:()=>true,verifyOutcome:()=>false,toolNamespace:'job'});
  assert.ok(shared.some(c=>c.name==='job.tasks.plan.update'));assert.ok(shared.at(-1).implementation.tools.includes('job.tasks.plan.read'));
  allowed=false;await assert.rejects(context.revalidateHistory({history,actor,dispatcher}),{statusCode:403});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
