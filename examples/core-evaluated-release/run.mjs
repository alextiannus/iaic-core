import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';import {Pool} from 'pg';
import {EvaluationRunner,FileEvaluationStore,ReleaseManager,PostgresReleaseStore,ObjectStorage,FileObjectStore,ReleaseResources,AgentRegistry,AgentIdentityStore,ReleaseBoundAgentIdentity} from '@immedi/iaic-core';
import {evidenceDigest} from '@immedi/iaic-core/evaluation/runner.js';
const planPath=process.env.IAIC_RELEASE_EVIDENCE_PLAN,out=process.env.IAIC_RELEASE_EVIDENCE_OUTPUT,connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;
if(!planPath||!out||!connectionString||!['localhost','127.0.0.1','[::1]'].includes(new URL(connectionString).hostname))throw Error('Explicit plan, fresh output and isolated local PostgreSQL required');
const plan=JSON.parse(await fs.readFile(planPath,'utf8'));await fs.mkdir(out,{recursive:true,mode:0o700});await fs.writeFile(path.join(out,'plan.json'),JSON.stringify(plan,null,2),{flag:'wx',mode:0o600});
const evaluations=new FileEvaluationStore({directory:path.join(out,'evaluations')}),runs={},frozen={},archives={};
for(const kind of ['baseline','candidate']){
 runs[kind]={};let configuration;
 for(const suite of ['capability','regression']){
  const directory=plan[kind][suite],result=JSON.parse(await fs.readFile(path.join(directory,'result.json'),'utf8'));assert.equal(result.realModel,true);assert.equal(result.gate.passed,true);
  const run=await new FileEvaluationStore({directory}).get(result.stored.id);await evaluations.put(run);runs[kind][suite]=run;
  const f=JSON.parse(await fs.readFile(path.join(directory,'frozen.json'),'utf8'));assert.equal(run.revision,f.revision);
  const current=Object.fromEntries(['revision','sourceRevision','model','provider','invocation','skillDigest','sourceDigest','maxTurns','maxCalls','maxBatchCalls','taskTimeoutMs','promptAppend','promptDigest'].filter(k=>f[k]!==undefined).map(k=>[k,f[k]]));
  if(configuration)assert.deepEqual(current,configuration,'Suites must evaluate the same frozen implementation/configuration');else configuration=current;
 }
 assert.equal(runs[kind].capability.revision,runs[kind].regression.revision);frozen[kind]=configuration;
 const bytes=await fs.readFile(plan[kind].archive);assert.equal('sha512-'+createHash('sha512').update(bytes).digest('base64'),plan[kind].integrity);archives[kind]=bytes;
}
assert.notEqual(runs.baseline.capability.datasetDigest,runs.baseline.regression.datasetDigest,'Use distinct capability and regression suites');
assert.notEqual(runs.baseline.capability.revision,runs.candidate.capability.revision,'A concrete changed candidate is required');
const required=['task_succeeded','artifact_content','source_read','skill_read','memory_read','scope_preserved','billing_settled'];
const policies=Object.fromEntries(['capability','regression'].map(suite=>{const r=runs.baseline[suite];return [suite,{datasetDigest:r.datasetDigest,graderRevision:r.graderRevision,environmentRevision:r.environmentRevision,repeats:r.repeats,baselineId:r.id,thresholds:{requiredChecks:required}}];}));
const schema='evaluated_release_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
try{
 const actor={subjectId:'release-evidence-owner',scopeId:'isolated-release-evidence'},authorize=a=>a.subjectId===actor.subjectId;
 const store=new PostgresReleaseStore({pool,namespace:'actual-agent-evidence'});await store.initialize();
 const manager=new ReleaseManager({store,evaluations,policies,authorize,resolveCohort:a=>a.subjectId});
 const objects=new ObjectStorage({store:new FileObjectStore({directory:path.join(out,'objects')}),resolveScope:a=>a.subjectId,authorize}),manifests={};
 for(const kind of ['baseline','candidate']){
  const f=frozen[kind],resources=[];
  for(const [name,bytes] of [['core.tgz',archives[kind]],['agent-config.json',Buffer.from(JSON.stringify(f))],['prompt-append.txt',Buffer.from(f.promptAppend??'')]]){const ref=await objects.put(actor,bytes);resources.push({path:name,...ref,reference:ref});}
  manifests[kind]={id:kind,implementationRevision:runs[kind].capability.revision,versions:{prompt:evidenceDigest({sourceRevision:f.sourceRevision??f.revision,append:f.promptAppend??''}),model:evidenceDigest({model:f.model,provider:f.provider,invocation:f.invocation??null}),skills:f.skillDigest,tools:resources[0].sha256,knowledge:f.sourceDigest,harness:resources[0].sha256},resources,evidenceScope:'Authored actual-model capability and regression samples; local release drill, no production deployment'};
 }
 const refs=kind=>Object.fromEntries(['capability','regression'].map(s=>[s,runs[kind][s].id]));
 await manager.register(actor,{manifest:manifests.baseline,evaluations:refs('baseline')});
 await assert.rejects(manager.register(actor,{manifest:{...manifests.candidate,id:'wrong-version',implementationRevision:manifests.baseline.implementationRevision},evaluations:refs('candidate')}),{statusCode:409});
 const cap=runs.candidate.capability,dataset=JSON.parse(await fs.readFile(path.join(plan.candidate.capability,'dataset.json'),'utf8'));
 const failed=await new EvaluationRunner({execute:()=>{throw Error('Injected candidate startup failure: no provider request');},grade:()=>{throw Error('No grading after execution failure');}}).run({dataset,revision:'injected-startup-failure',graderRevision:cap.graderRevision,environmentRevision:cap.environmentRevision,repeats:cap.repeats});await evaluations.put(failed);
 await assert.rejects(manager.register(actor,{manifest:{...manifests.candidate,id:'injected-failure',implementationRevision:failed.revision},evaluations:{capability:failed.id,regression:runs.candidate.regression.id}}),error=>error.statusCode===409&&error.message==='Candidate failed the capability evaluation gate');
 await manager.register(actor,{manifest:manifests.candidate,evaluations:refs('candidate')});
 await manager.setChannel(actor,{name:'acceptance',stableId:'baseline',expectedRevision:0});await manager.setChannel(actor,{name:'acceptance',stableId:'baseline',canaryId:'candidate',percentage:100,expectedRevision:1});
 const selected=await manager.resolve(actor,'acceptance');assert.equal(selected.releaseId,'candidate');
 const resources=new ReleaseResources({releases:manager,readResource:(a,ref)=>objects.get(a,ref)}),loaded=await resources.read(actor,selected);
 assert.equal(loaded.files.find(f=>f.path==='prompt-append.txt').bytes.toString(),frozen.candidate.promptAppend);
 assert.deepEqual(JSON.parse(loaded.files.find(f=>f.path==='agent-config.json').bytes.toString()),frozen.candidate);
 assert.deepEqual(loaded.files.find(f=>f.path==='core.tgz').bytes,archives.candidate);
 const identities=new AgentIdentityStore({pool});await identities.initialize();const registry=new AgentRegistry({store:identities,definitions:[{id:'evaluated-worker',purpose:'Run the evaluated application configuration',capabilities:['assistant.run']}],resolveScope:a=>({applicationId:a.scopeId,subjectId:a.subjectId}),authorizeStateChange:authorize});
 const identity={bind:({actor,capability})=>registry.bind(actor,'evaluated-worker',capability.name),check:({actor,task,binding})=>registry.check(actor,binding,task.capability)};
 const bound=new ReleaseBoundAgentIdentity({identity,releases:manager,reference:selected,implementationRevision:selected.manifest.implementationRevision});
 const agent=await bound.bind({actor,capability:{name:'assistant.run'},version:selected.manifest.implementationRevision});const task={capability:'assistant.run',version:selected.manifest.implementationRevision,agent};await bound.check({actor,task,binding:agent});
 const assessmentId=evidenceDigest({purpose:'Authorized rollback acceptance drill',candidate:selected.manifestDigest});
 const rollback=await manager.rollback(actor,{name:'acceptance',expectedRevision:2,candidateId:'candidate',manifestDigest:selected.manifestDigest,fallbackId:'baseline',evidence:{assessmentId,kind:'authorized-acceptance-drill',observedRegression:false}});
 await assert.rejects(bound.check({actor,task,binding:agent}),{statusCode:409});await assert.rejects(resources.read(actor,selected),{statusCode:409});
 const rebuilt=new ReleaseManager({store:new PostgresReleaseStore({pool,namespace:'actual-agent-evidence'}),evaluations,policies,authorize,resolveCohort:a=>a.subjectId});
 const current=await rebuilt.resolve(actor,'acceptance');assert.equal(current.releaseId,'baseline');
 const fallback=await new ReleaseResources({releases:rebuilt,readResource:(a,ref)=>objects.get(a,ref)}).read(actor,current);assert.deepEqual(fallback.files.find(f=>f.path==='core.tgz').bytes,archives.baseline);assert.equal(fallback.files.find(f=>f.path==='prompt-append.txt').bytes.length,0);
 const receipt=await rebuilt.rollbackReceipt(actor,{name:'acceptance',expectedRevision:2,assessmentId});assert.equal(receipt.data.after.revision,rollback.revision);const history=await rebuilt.history(actor);assert.equal(history.filter(e=>e.action==='rollback').length,1);
 assert.equal(await store.get('injected-failure'),null);assert.equal(await store.get('wrong-version'),null);
 const result={passed:true,realModelEvaluations:true,releaseChecksActualPostgres:true,postReleaseInference:false,rollbackDrill:true,observedRegression:false,productionDeployed:false,runs:Object.fromEntries(Object.entries(runs).map(([k,v])=>[k,Object.fromEntries(Object.entries(v).map(([s,r])=>[s,{id:r.id,revision:r.revision,datasetDigest:r.datasetDigest}]))])),policies,manifests,selected,current,rollback,receipt,history,failedFixtureRun:failed.id,records:{baseline:await store.get('baseline'),candidate:await store.get('candidate')}};
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({passed:true,actualEvaluationBound:true,separateSuites:true,wrongVersionRejected:true,failedFixtureRejected:true,checkedResources:true,stoppedBindingRejected:true,originalRollbackReceipt:true,reconstructedFallback:true,postReleaseInference:false,productionDeployed:false}));
}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
