import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {ReleaseBoundAgentIdentity,ReleaseManager,PostgresReleaseStore,EvaluationRunner,AgentIdentityStore,AgentRegistry,TaskStore,AgentRuntime,ContextAssembler,CapabilityDispatcher,defineCapability} from '@immedi/iaic-core';
async function fixture(fn){const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');const schema='released_agent_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let runtime;
 try{
  const actor={subjectId:'user',scopeId:'app'},platform={subjectId:'platform'},runs=new Map();
  const runner=new EvaluationRunner({execute:({input})=>({value:input.value}),grade:({observation,testCase})=>({passed:observation.value===testCase.expected,score:observation.value===testCase.expected?1:0,checks:[{name:'outcome',passed:observation.value===testCase.expected}]})});
  const policies={},refs={v1:{},v2:{}};for(const revision of ['v1','v2'])for(const suite of ['capability','regression']){const r=await runner.run({dataset:[{id:suite,category:suite,input:{value:suite},expected:suite}],revision,graderRevision:suite+'-v1',environmentRevision:'fixture'});runs.set(r.id,r);refs[revision][suite]=r.id;policies[suite]={datasetDigest:r.datasetDigest,graderRevision:r.graderRevision,environmentRevision:r.environmentRevision,repeats:1};}
  const store=new PostgresReleaseStore({pool,namespace:'agent'});await store.initialize();
  const releases=new ReleaseManager({store,evaluations:{get:id=>runs.get(id)},policies,resolveCohort:a=>a.subjectId,authorize:(a,{action})=>a.subjectId==='platform'||a.subjectId==='user'&&['resolve','check'].includes(action)});
  for(const [id,revision] of [['baseline','v1'],['candidate','v2']])await releases.register(platform,{manifest:{id,implementationRevision:revision,versions:{prompt:'prompt-'+revision,model:'fixture',skills:'fixture',tools:'fixture',knowledge:'fixture',harness:'v1'}},evaluations:refs[revision]});
  await releases.setChannel(platform,{name:'work',stableId:'baseline',canaryId:'candidate',percentage:100,expectedRevision:0});
  const selected=await releases.resolve(actor,'work'),identities=new AgentIdentityStore({pool});await identities.initialize();
  const registry=new AgentRegistry({store:identities,definitions:[{id:'worker',purpose:'Work under an evaluated implementation',capabilities:['work.run']}],resolveScope:a=>({applicationId:a.scopeId,subjectId:a.subjectId}),authorizeStateChange:()=>true});
  let modelCalls=0,effects=0,stopDuringModel=false;
  const tool=defineCapability({name:'work.effect',description:'Fixture effect',input:{type:'object'},output:{type:'object'},effect:'write',retry:'never-replay',authorize:a=>a.subjectId==='user',revalidate:async(_i,r)=>r,implementation:{kind:'function',execute:async()=>{effects++;return {done:true};}}});
  const agent=defineCapability({name:'work.run',description:'Released work',input:{type:'object'},output:{type:'object'},effect:'read',authorize:a=>a.subjectId==='user',implementation:{kind:'agent',instructions:'Complete the scoped effect',tools:[tool.name],verify:async()=>effects===1}});
  const dispatcher=new CapabilityDispatcher({capabilities:[tool,agent]}),tasks=new TaskStore({pool}),model={name:'fixture',next:async r=>{modelCalls++;if(stopDuringModel)await releases.stop(platform,'candidate');const c=JSON.parse(r.messages.find(m=>m.role==='user').content);return c.calls.length?{type:'finish',result:{done:true}}:{type:'call',name:tool.name,input:{}};}};
  const base={bind:({actor,capability})=>registry.bind(actor,'worker',capability.name),check:({actor,task,binding})=>registry.check(actor,binding,task.capability)};
  const build=async(reference=selected,{version=reference.manifest.implementationRevision,revision=reference.manifest.implementationRevision}={})=>{await runtime?.stop();runtime=new AgentRuntime({store:tasks,dispatcher,model,version,context:new ContextAssembler({skillRoot:'/tmp'}),agentIdentity:new ReleaseBoundAgentIdentity({identity:base,releases,reference,implementationRevision:revision})});dispatcher.tasks=runtime;await runtime.initialize();return runtime;};await build();
  await fn({actor,platform,selected,releases,registry,agent,tasks,build,runtime:()=>runtime,counts:()=>({modelCalls,effects}),stopDuringModel:()=>{stopDuringModel=true;}});
 }finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
test('Original Agent release survives reconstruction/channel changes and stops before further execution',async()=>fixture(async f=>{
 const task=await f.runtime().create({actor:f.actor,capability:f.agent,input:{goal:'Complete work'},idempotencyKey:'work'});assert.equal(task.agent.release.releaseId,'candidate');
 await f.releases.setChannel(f.platform,{name:'work',stableId:'baseline',expectedRevision:1});await f.build();assert.equal((await f.runtime().tick()).status,'succeeded');assert.deepEqual(f.counts(),{modelCalls:2,effects:1});
 const waiting=await f.runtime().create({actor:f.actor,capability:f.agent,input:{goal:'Later work'},idempotencyKey:'later'});await f.releases.stop(f.platform,'candidate');await f.build();assert.equal((await f.runtime().tick()).status,'waiting');assert.deepEqual(f.counts(),{modelCalls:2,effects:1});
 await assert.rejects(f.runtime().create({actor:f.actor,capability:f.agent,input:{},idempotencyKey:'stopped'}),{statusCode:409});assert.equal((await f.tasks.get(f.actor,waiting.id)).agent.release.releaseId,'candidate');
}));
test('A stop while the model is returning prevents the proposed tool action',async()=>fixture(async f=>{
 await f.runtime().create({actor:f.actor,capability:f.agent,input:{},idempotencyKey:'stop-during-model'});f.stopDuringModel();assert.equal((await f.runtime().tick()).status,'waiting');assert.deepEqual(f.counts(),{modelCalls:1,effects:0});
}));
test('Wrong Runtime versions, substituted release bindings and paused identities are rejected',async()=>fixture(async f=>{
 await f.build(f.selected,{version:'other'});await assert.rejects(f.runtime().create({actor:f.actor,capability:f.agent,input:{},idempotencyKey:'wrong'}),{statusCode:409});
 await f.build(f.selected,{version:'other',revision:'other'});await assert.rejects(f.runtime().create({actor:f.actor,capability:f.agent,input:{},idempotencyKey:'wrong-manifest'}),{statusCode:409});
 await f.build();const task=await f.runtime().create({actor:f.actor,capability:f.agent,input:{},idempotencyKey:'pinned'});await f.releases.setChannel(f.platform,{name:'work',stableId:'baseline',expectedRevision:1});
 await f.build(await f.releases.resolve(f.actor,'work'));await assert.rejects(f.runtime().agentIdentity.check({actor:f.actor,task,binding:task.agent}),{statusCode:409});assert.equal(await f.runtime().tick(),null);assert.equal((await f.tasks.get(f.actor,task.id)).status,'waiting');assert.deepEqual(f.counts(),{modelCalls:0,effects:0});assert.equal((await f.tasks.get(f.actor,task.id)).agent.release.releaseId,'candidate');
 await f.build();const instance=(await f.registry.describe(f.actor,'worker')).instance;await f.registry.setState(f.actor,'worker',{state:'paused',expectedRevision:instance.revision});
 await assert.rejects(f.runtime().create({actor:f.actor,capability:f.agent,input:{},idempotencyKey:'paused'}),{code:'AGENT_PAUSED'});
}));
