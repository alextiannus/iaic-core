import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EvaluationRunner,evaluateGate,compareEvaluations,FileEvaluationStore} from '@immedi/iaic-core';
const dataset=[{id:'one',category:'planning',input:{value:2},expected:4},{id:'two',category:'__proto__',input:{value:3},expected:6}];
const settings={dataset,revision:'implementation-1',graderRevision:'grader-1',environmentRevision:'fixture-1',repeats:2};
const grade=({testCase,observation})=>({passed:observation.result===testCase.expected,score:observation.result===testCase.expected?1:0,checks:[{name:'result',passed:observation.result===testCase.expected}]});
test('Evaluation isolates answers, counts all repeats and compares pinned baseline cases',async()=>{
  const received=[];
  const runner=new EvaluationRunner({execute:args=>{assert.equal(args.expected,undefined);assert.equal(args.testCase,undefined);received.push(args.input.value);return {result:args.input.value*2,metrics:{providerTokens:10}};},grade});
  const baseline=await runner.run(settings);assert.deepEqual(received,[2,2,3,3]);
  assert.equal(evaluateGate(baseline,{requiredChecks:['result'],minimumCategoryPassRate:1}).passed,true);
  assert.equal(Object.prototype.total,undefined);
  const candidate=await new EvaluationRunner({execute:({input})=>({result:input.value===3?0:input.value*2}),grade}).run({...settings,revision:'implementation-2'});
  assert.equal(evaluateGate(candidate).passRate,.5);
  assert.equal(compareEvaluations(baseline,candidate).regressions.length,2);
  assert.throws(()=>compareEvaluations(baseline,{...candidate,graderRevision:'different'}),/graderRevision/);
});
test('Execution/grading failures, cancellation and incomplete evidence do not silently pass',async()=>{
  const runner=new EvaluationRunner({execute:({input})=>{if(input.value===2)throw new Error('fixture failure');return {result:6};},grade:()=>{throw new Error('grader failure');}});
  const result=await runner.run({...settings,repeats:1});
  assert.deepEqual(result.records.map(r=>r.error.phase),['execute','grade']);
  assert.equal(evaluateGate(result).passed,false);
  const controller=new AbortController();controller.abort();
  const cancelled=await runner.run({...settings,signal:controller.signal});
  assert.equal(cancelled.records.length,4);assert.ok(cancelled.records.every(r=>r.status==='cancelled'));
  assert.equal(evaluateGate(cancelled,{minimumPassRate:0,minimumMeanScore:0}).passed,false);
  const good=await new EvaluationRunner({execute:({input})=>({result:input.value*2}),grade}).run(settings);
  assert.equal(evaluateGate({...good,records:good.records.slice(1)},{minimumPassRate:0,minimumMeanScore:0}).passed,false);
  assert.equal(evaluateGate(good,{requiredChecks:['missing-check']}).passed,false);
  await assert.rejects(new EvaluationRunner({execute:()=>({result:4}),grade,onRecord:()=>{throw new Error('evidence sink failed');}}).run(settings),/evidence sink failed/);
});
test('File evidence survives re-instantiation, cannot be overwritten and detects changed content',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-evaluation-'));
  try{
    const run=await new EvaluationRunner({execute:({input})=>({result:input.value*2}),grade}).run(settings);
    const store=new FileEvaluationStore({directory}),reference=await store.put(run);
    assert.deepEqual(await new FileEvaluationStore({directory}).get(run.id),run);
    await assert.rejects(store.put(run),{code:'EEXIST'});
    const artifact=JSON.parse(await fs.readFile(reference.path,'utf8'));artifact.run.records[0].score=0;
    await fs.writeFile(reference.path,JSON.stringify(artifact));
    await assert.rejects(store.get(run.id),/digest/);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
