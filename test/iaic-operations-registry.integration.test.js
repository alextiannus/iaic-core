import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {OperationsRegistry} from '../operations/registry.js';
import {AgentIdentityStore} from '../identities/store.js';
import {TaskStore} from '../tasks/store.js';
import {readAgentTaskSources} from '../operations/task-source.js';
test('durable inventory, immutable boundaries, fenced presence, and private-free Task projection',async()=>{
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;assert.ok(connectionString);
 const schema='ops_live_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString});await admin.query('CREATE SCHEMA '+schema);
 const pool=new pg.Pool({connectionString,options:'-c search_path='+schema});
 try{
  const registry=new OperationsRegistry({pool,namespace:'app'}),other=new OperationsRegistry({pool,namespace:'other'}),identities=new AgentIdentityStore({pool}),tasks=new TaskStore({pool});
  await registry.initialize();await identities.initialize();await tasks.initialize();
  const scope={applicationId:'tenant-a',subjectId:'owner',definitionId:'job'},instance=await identities.ensure(scope);
  assert.equal((await identities.page({definitionId:'job'})).items[0].id,instance.id);
  const descriptor={id:instance.id,name:'Assistant',role:'user-assistant',location:'internal',lifecycle:'active',workspaceId:'tenant-a',principalId:'owner',reference:{source:'AgentIdentityStore',id:instance.id,revision:'1'}};
  await registry.register(descriptor);await registry.register(descriptor);
  await assert.rejects(registry.register({...descriptor,principalId:'other'}),{statusCode:409});
  assert.deepEqual((await registry.page()).items,[descriptor]);assert.equal((await registry.page({workspaceIds:['tenant-b']})).items.length,0);assert.equal((await other.page()).items.length,0);
  const generation=await registry.startExecutor('worker');
  assert.equal(await registry.presence('worker'),null);
  await registry.heartbeat('worker',{generation,sequence:1});assert.equal((await registry.presence('worker')).state,'healthy');
  await assert.rejects(registry.heartbeat('worker',{generation,sequence:1}),{statusCode:409});
  const next=await registry.startExecutor('worker');await assert.rejects(registry.heartbeat('worker',{generation,sequence:2}),{statusCode:409});
  await registry.heartbeat('worker',{generation:next,sequence:1,ttlMs:1000});
  await pool.query("UPDATE iaic_operations_presence SET valid_until=clock_timestamp()-interval '1 second'");
  assert.ok(Date.parse((await registry.presence('worker')).validUntil)<Date.now());
  const actor={scopeId:'tenant-a',subjectId:'owner'},task=await tasks.create({actor,capability:'work',input:{secret:'never-output'},idempotencyKey:'one',version:'1',model:'host-model-resolver',agent:{instanceId:instance.id}});
  await pool.query("INSERT INTO iaic_task_events(task_id,kind,data) VALUES($1,'model_requested',$2)",[task.id,{model:'resolved-model',privateText:'never-output'}]);
  const projected=await readAgentTaskSources({tasks,actor,instanceId:instance.id});
  assert.equal(projected.tasks.items[0].id,task.id);assert.equal(projected.models.items[0].requestedModel,'resolved-model');assert.equal(projected.models.items[0].actualModel,null);assert.equal(projected.interactions.items[0].from,actor.subjectId);
  assert.doesNotMatch(JSON.stringify(projected),/never-output/);
  assert.equal((await tasks.agentSummary({...actor,scopeId:'other'},instance.id)).items.length,0);
  await tasks.create({actor,capability:'work',input:{},idempotencyKey:'two',version:'1',model:'pinned',agent:{instanceId:instance.id}});
  assert.equal((await tasks.agentSummary(actor,instance.id,{limit:1})).complete,false);
 }finally{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
});
