import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EvaluationRunner,FileEvaluationStore,createEvaluationCapabilities,CapabilityDispatcher} from '@immedi/iaic-core';
const actor={subjectId:'platform-maintainer'};
const settings={dataset:[{id:'one',category:'result',input:{value:2},expected:4}],revision:'baseline',graderRevision:'grade-1',environmentRevision:'fixture-1'};
async function evidence(result,revision){return new EvaluationRunner({execute:()=>({result}),grade:({testCase,observation})=>({passed:observation.result===testCase.expected,score:observation.result===testCase.expected?1:0,checks:[{name:'outcome',passed:observation.result===testCase.expected}]})}).run({...settings,revision});}
test('Platform evidence reads and comparisons preserve original failures and reject incompatible runs',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-platform-evaluation-'));
 try{
  const store=new FileEvaluationStore({directory}),baseline=await evidence(4,'baseline'),candidate=await evidence(0,'candidate');
  await store.put(baseline);await store.put(candidate);
  const caps=createEvaluationCapabilities({readEvaluation:(_actor,id)=>new FileEvaluationStore({directory}).get(id),authorize:who=>who.subjectId===actor.subjectId});
  const dispatcher=new CapabilityDispatcher({capabilities:caps});
  const read=await dispatcher.invoke('evaluations.read',{id:candidate.id},{actor});
  assert.deepEqual(read.run,candidate);assert.match(read.digest,/^[a-f0-9]{64}$/);
  const comparison=await dispatcher.invoke('evaluations.compare',{baselineId:baseline.id,candidateId:candidate.id},{actor});
  assert.equal(comparison.candidate.digest,read.digest);assert.equal(comparison.comparison.noRegressions,false);assert.equal(comparison.comparison.regressions.length,1);
  await assert.rejects(dispatcher.invoke('evaluations.compare',{baselineId:baseline.id,candidateId:candidate.id,minimumPassRate:0},{actor}),{statusCode:400});
  const incompatible={...candidate,id:'other-grader',graderRevision:'grade-2'};await store.put(incompatible);
  await assert.rejects(dispatcher.invoke('evaluations.compare',{baselineId:baseline.id,candidateId:incompatible.id},{actor}),/graderRevision/);
  assert.deepEqual(await store.get(candidate.id),candidate);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('Both comparison artifacts require current authority before reads and on history revalidation',async()=>{
 const baseline=await evidence(4,'baseline'),candidate=await evidence(0,'candidate');let allowed=new Set([baseline.id]),reads=0,revokeDuringRead=false;
 const caps=createEvaluationCapabilities({authorize:(_actor,{id})=>allowed.has(id),readEvaluation:async(_actor,id)=>{reads++;if(revokeDuringRead)allowed.clear();return id===baseline.id?baseline:candidate;}});
 const dispatcher=new CapabilityDispatcher({capabilities:caps}),input={baselineId:baseline.id,candidateId:candidate.id};
 await assert.rejects(dispatcher.invoke('evaluations.compare',input,{actor}),{statusCode:403});assert.equal(reads,0);
 allowed.add(candidate.id);const comparison=await dispatcher.invoke('evaluations.compare',input,{actor});assert.equal(reads,2);
 allowed.delete(candidate.id);await assert.rejects(caps[1].revalidate(input,comparison,{actor}),{statusCode:403});assert.equal(reads,2);
 revokeDuringRead=true;await assert.rejects(dispatcher.invoke('evaluations.read',{id:baseline.id},{actor}),{statusCode:403});assert.equal(reads,3);
});
test('Evaluation evidence reader cannot substitute a different artifact',async()=>{
 const dispatcher=new CapabilityDispatcher({capabilities:createEvaluationCapabilities({authorize:()=>true,readEvaluation:()=>({id:'different'})})});
 await assert.rejects(dispatcher.invoke('evaluations.read',{id:'requested'},{actor}),/different run/);
 assert.throws(()=>createEvaluationCapabilities({readEvaluation:()=>null}),/authorization ports/);
});
