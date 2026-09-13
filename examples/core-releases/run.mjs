import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Pool} from 'pg';
import {ReleaseBoundAgentIdentity,AgentIdentityStore,AgentRegistry,TaskStore,AgentRuntime,ContextAssembler,defineCapability,EvaluationRunner,FileEvaluationStore,ReleaseManager,PostgresReleaseStore,createReleaseCapabilities,CapabilityDispatcher,FileObjectStore,ObjectStorage,ReleaseResources,DockerSandbox,ReleasedCode,createCodeExecutionCapability,PostgresObservationStore,ReleaseObservation,createObservationCapabilities,PostgresMonitorCycles,PersistentReleaseMonitor,createMonitorCycleCapabilities,ReleaseMonitor,createReleaseMonitorCapability} from '@immedi/iaic-core';
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL URL required');
const schema='releases_example_'+randomUUID().replaceAll('-',''),directory=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-release-example-'));
const admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let releasedRuntime;
try{
 const evaluations=new FileEvaluationStore({directory}),runs=[];
 const runner=new EvaluationRunner({execute:({input})=>({result:input}),grade:({observation,testCase})=>({passed:observation.result===testCase.expected,score:1,checks:[{name:'outcome',passed:observation.result===testCase.expected}]})});
 for(const revision of ['fixture-v1','fixture-v2']){const run=await runner.run({dataset:[{id:'case',category:'core-example',input:'verified',expected:'verified'}],revision,graderRevision:'grader1',environmentRevision:'fixture1'});await evaluations.put(run);runs.push(run);}
 const p={datasetDigest:runs[0].datasetDigest,graderRevision:'grader1',environmentRevision:'fixture1',repeats:1,thresholds:{requiredChecks:['outcome']}};
 const store=new PostgresReleaseStore({pool,namespace:'example'});await store.initialize();
 const manager=new ReleaseManager({store,evaluations,policies:{capability:p,regression:{...p,baselineId:runs[0].id}},authorize:a=>a.subjectId==='platform',resolveCohort:a=>a.subjectId}),actor={subjectId:'platform'};
 const objects=new ObjectStorage({store:new FileObjectStore({directory:path.join(directory,'objects')}),resolveScope:a=>a.subjectId,authorize:a=>a.subjectId==='platform'});
 const code=await objects.put(actor,Buffer.from("import fs from 'node:fs';console.log(JSON.stringify({value:JSON.parse(fs.readFileSync(0,'utf8')).value*2}));"));
 for(const run of runs){const ref=await objects.put(actor,Buffer.from('Prompt '+run.revision));await manager.register(actor,{manifest:{id:run.revision,implementationRevision:run.revision,resources:[{path:'prompts/main.txt',...ref,reference:ref},{path:'main.mjs',...code,reference:code}],versions:{prompt:ref.sha256,model:'fixture1',skills:'none1',tools:'fixture1',knowledge:'none1',harness:'fixture1'}},evaluations:{capability:run.id,regression:run.id}});}
 await manager.setChannel(actor,{name:'production',stableId:'fixture-v1',expectedRevision:0});
 await manager.setChannel(actor,{name:'production',stableId:'fixture-v1',canaryId:'fixture-v2',percentage:100,expectedRevision:1});
 const dispatcher=new CapabilityDispatcher({capabilities:createReleaseCapabilities({releases:manager})});
 const selected=await dispatcher.invoke('releases.resolve',{name:'production'},{actor});assert.equal(selected.releaseId,'fixture-v2');
 const resources=new ReleaseResources({releases:manager,readResource:(a,ref)=>objects.get(a,ref)});
 const loaded=await resources.materialize(actor,selected,{parentDirectory:directory});assert.equal(await fs.readFile(path.join(loaded.directory,'prompts/main.txt'),'utf8'),'Prompt fixture-v2');
 const execution=new ReleasedCode({resources,parentDirectory:directory,authorize:a=>a.subjectId==='platform',sandbox:new DockerSandbox({image:'node@sha256:8094c002d08262dba12645a3b4a15cd6cd627d30bc782f53229a2ec13ee22a00',command:['node','/work/main.mjs']})});
 const codeDispatcher=new CapabilityDispatcher({capabilities:[createCodeExecutionCapability({execution})]});
 const request={release:{releaseId:selected.releaseId,manifestDigest:selected.manifestDigest},input:{value:21}};
 const executed=await codeDispatcher.invoke('code.run',request,{actor,callId:randomUUID()});assert.equal(executed.status,'succeeded',executed.stderr);assert.equal(executed.cleanupConfirmed,true);assert.equal(JSON.parse(executed.stdout).value,42);
 const agentActor={...actor,scopeId:'released-example'},identityStore=new AgentIdentityStore({pool});await identityStore.initialize();
 const registry=new AgentRegistry({store:identityStore,definitions:[{id:'released-worker',purpose:'Work under a checked release',capabilities:['released.work']}],resolveScope:a=>({applicationId:a.scopeId,subjectId:a.subjectId}),authorizeStateChange:()=>true});
 const identity={bind:({actor,capability})=>registry.bind(actor,'released-worker',capability.name),check:({actor,task,binding})=>registry.check(actor,binding,task.capability)};let modelCalls=0;
 const buildAgent=async(reference,prompt)=>{
  await releasedRuntime?.stop();
  const agent=defineCapability({name:'released.work',description:'Execute a pinned Agent implementation',input:{type:'object'},output:{type:'object'},effect:'read',authorize:a=>a.subjectId==='platform',implementation:{kind:'agent',instructions:prompt,tools:[],verify:async(_i,r)=>r.prompt===prompt}}),dispatch=new CapabilityDispatcher({capabilities:[agent]});
  releasedRuntime=new AgentRuntime({store:new TaskStore({pool}),dispatcher:dispatch,model:{name:'fixture-model',next:async()=>{modelCalls++;return {type:'finish',result:{prompt}};}},context:new ContextAssembler({skillRoot:directory}),version:reference.manifest.implementationRevision,agentIdentity:new ReleaseBoundAgentIdentity({identity,releases:manager,reference,implementationRevision:reference.manifest.implementationRevision})});dispatch.tasks=releasedRuntime;await releasedRuntime.initialize();return agent;
 };
 const candidateAgent=await buildAgent(selected,await fs.readFile(path.join(loaded.directory,'prompts/main.txt'),'utf8'));
 const pendingAgent=await releasedRuntime.create({actor:agentActor,capability:candidateAgent,input:{goal:'Use the pinned implementation'},idempotencyKey:'candidate-agent'});
 const observations=new PostgresObservationStore({pool,namespace:'example'});await observations.initialize();const clock=new Date();
 const observation=new ReleaseObservation({store:observations,releases:manager,sourceScope:'example',authorize:a=>a.subjectId==='platform',now:()=>clock,discoverSources:()=>({sourceIds:['container-result'],complete:true}),policies:{production:{revision:'strict-fixture-budget',fallbackId:'fixture-v1',minSamples:1,maxErrorRate:0,maxMeanLatencyMs:0,windowMs:60000,maxAssessmentAgeMs:60000}},resolveSource:sourceId=>({confirmed:true,sourceId,sourceScope:'example',record:{releaseId:selected.releaseId,manifestDigest:selected.manifestDigest,observedAt:new Date(clock.getTime()-1).toISOString(),success:executed.status==='succeeded',durationMs:executed.durationMs,toolErrors:0,providerTokens:'0',platformUnits:'0'}})});
 const monitor=new CapabilityDispatcher({capabilities:createObservationCapabilities({observation,includeRecovery:true})});await monitor.invoke('observation.record',{sourceId:'container-result'},{actor,callId:'observe'});
 const assessment=await monitor.invoke('observation.assess',{channel:'production',releaseId:selected.releaseId,manifestDigest:selected.manifestDigest},{actor,callId:'assess'});assert.equal(assessment.shouldStop,true);assert.deepEqual(assessment.violations,['mean-latency']);
 // The zero-millisecond fixture budget intentionally triggers the stop path.
 await assert.rejects(monitor.invoke('observation.protect',{assessmentId:assessment.id,expectedRevision:1},{actor,callId:'stale'}),{statusCode:409});await manager.check(actor,selected);
 const cycle=new ReleaseMonitor({observation,resolveTarget:async(a,{channel})=>({...selected,expectedRevision:(await manager.channel(a,channel)).revision}),authorize:a=>a.subjectId==='platform',autoProtect:true});
 const cycleStore=new PostgresMonitorCycles({pool,namespace:'example'});await cycleStore.initialize();
 const persistentCycle=new PersistentReleaseMonitor({monitor:cycle,store:cycleStore,resolveOwner:a=>a.subjectId,authorize:a=>a.subjectId==='platform'});
 const periodicOperation=new CapabilityDispatcher({capabilities:createMonitorCycleCapabilities({cycles:persistentCycle})});
 const cycleResult=await periodicOperation.invoke('monitor_cycle.run',{channel:'production',requestKey:'monitor-cycle'},{actor,callId:'monitor-cycle'});assert.equal(cycleResult.collectionComplete,true);assert.equal(cycleResult.assessment.metrics.samples,1);assert.equal(cycleResult.protection.stableId,'fixture-v1');await assert.rejects(codeDispatcher.invoke('code.run',request,{actor,callId:randomUUID()}));await assert.rejects(manager.check(actor,selected),{statusCode:409});
 assert.deepEqual(await periodicOperation.invoke('monitor_cycle.recover',{channel:'production',requestKey:'monitor-cycle'},{actor,callId:'recover-monitor-cycle'}),cycleResult);
 const recovered=await monitor.invoke('observation.protection_result',{assessmentId:cycleResult.assessment.id,expectedRevision:2},{actor});assert.equal(recovered.status,'confirmed');assert.deepEqual(recovered.protection,cycleResult.protection);assert.equal((await store.history()).filter(e=>e.action==='rollback').length,1);
 assert.equal((await releasedRuntime.tick()).status,'waiting');assert.equal(modelCalls,0);assert.equal((await releasedRuntime.store.get(agentActor,pendingAgent.id)).agent.release.releaseId,selected.releaseId);
 const fallback=await manager.resolve(actor,'production');const after=await codeDispatcher.invoke('code.run',{release:{releaseId:fallback.releaseId,manifestDigest:fallback.manifestDigest},input:{value:21}},{actor,callId:randomUUID()});assert.equal(after.status,'succeeded');assert.equal(JSON.parse(after.stdout).value,42);
 const fallbackResources=await resources.materialize(agentActor,fallback,{parentDirectory:directory}),fallbackAgent=await buildAgent(fallback,await fs.readFile(path.join(fallbackResources.directory,'prompts/main.txt'),'utf8'));
 await releasedRuntime.create({actor:agentActor,capability:fallbackAgent,input:{goal:'Use the fallback implementation'},idempotencyKey:'fallback-agent'});assert.equal((await releasedRuntime.tick()).status,'succeeded');assert.equal(modelCalls,1);
 assert.equal((await manager.resolve(actor,'production')).releaseId,'fixture-v1');
 console.log(JSON.stringify({example:'core-releases',status:'passed',boundEvaluationEvidence:true,canaryStopped:true,rollbackSelection:true,materializedResources:true,containerExecution:true,stoppedCodeDenied:true,observedAtomicRollback:true,trustedCollectionCycle:true,fallbackExecuted:true,originalProtectionReceipt:true,persistentCycle:true,stoppedAgentBlocked:true,fallbackAgentExecuted:true,productionDeployed:false}));
}finally{await releasedRuntime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await fs.rm(directory,{recursive:true,force:true});}
