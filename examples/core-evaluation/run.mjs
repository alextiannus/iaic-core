import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EvaluationRunner,evaluateGate,compareEvaluations,FileEvaluationStore,CapabilityDispatcher,defineCapability} from '@immedi/iaic-core';
const dispatcher=new CapabilityDispatcher({capabilities:[defineCapability({name:'numbers.double',description:'Double a number',input:{type:'number'},output:{type:'number'},effect:'read',authorize:actor=>actor.subjectId==='fixture',implementation:{kind:'function',execute:value=>value*2}})]});
const dataset=[{id:'positive',category:'arithmetic',input:3,expected:6},{id:'negative',category:'arithmetic',input:-2,expected:-4}];
const grade=({testCase,observation})=>({passed:observation.result===testCase.expected,score:observation.result===testCase.expected?1:0,checks:[{name:'outcome',passed:observation.result===testCase.expected}]});
const settings={dataset,revision:'fixture-capability-v1',graderRevision:'exact-result-v1',environmentRevision:'local-fixture-v1',repeats:2};
const baseline=await new EvaluationRunner({execute:async({input})=>({result:await dispatcher.invoke('numbers.double',input,{actor:{subjectId:'fixture'}})}),grade}).run(settings);
const candidate=await new EvaluationRunner({execute:({input})=>({result:input<0?0:input*2}),grade}).run({...settings,revision:'broken-fixture-v2'});
assert.equal(evaluateGate(baseline,{requiredChecks:['outcome']}).passed,true);
assert.equal(evaluateGate(candidate,{requiredChecks:['outcome']}).passed,false);
assert.equal(compareEvaluations(baseline,candidate).noRegressions,false);
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-evaluation-example-'));
try{const store=new FileEvaluationStore({directory});await store.put(baseline);await store.put(candidate);assert.equal((await store.get(candidate.id)).records.length,4);}
finally{await fs.rm(directory,{recursive:true,force:true});}
console.log(JSON.stringify({example:'core-evaluation',status:'passed',regressionDetected:true,preservedFailedCandidate:true,modelQualityClaim:false}));
