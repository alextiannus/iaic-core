import {createHash, randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
const fail = message => new Error(message);
export function jsonValue(value) {
  let copy;
  try {copy = JSON.parse(JSON.stringify(value));} catch {throw fail('Evaluation evidence must be serializable JSON');}
  if (!isDeepStrictEqual(value, copy)) throw fail('Evaluation evidence must contain plain JSON values');
  return copy;
}
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,ordered(value[key])])) : value;
export const evidenceDigest = value => createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
const label = value => typeof value === 'string' && value.trim().length > 0;

export class EvaluationRunner {
  constructor({execute, grade, onRecord = async () => {}}) {
    if ([execute,grade,onRecord].some(fn => typeof fn !== 'function')) throw fail('Evaluation requires execute, grade and optional evidence callback ports');
    Object.assign(this,{execute,grade,onRecord});
  }
  async run({dataset, revision, graderRevision, environmentRevision, repeats = 1, signal}) {
    const cases = jsonValue(dataset);
    if (!Array.isArray(cases) || !cases.length || cases.some(c => !label(c.id) || !label(c.category) || !Object.hasOwn(c,'input')) || new Set(cases.map(c => c.id)).size !== cases.length) throw fail('Dataset requires unique case IDs, categories and inputs');
    if (![revision,graderRevision,environmentRevision].every(label) || !Number.isInteger(repeats) || repeats < 1 || repeats > 100) throw fail('Evaluation requires pinned revisions and a positive repeat count');
    const schedule = cases.flatMap(c => Array.from({length:repeats},(_,repeat)=>({caseId:c.id,category:c.category,repeat})));
    const run = {id: randomUUID(), revision, graderRevision, environmentRevision, datasetDigest: evidenceDigest(cases), repeats, expectedRecords: cases.length * repeats, schedule, records: []};
    for (const testCase of cases) for (let repeat = 0; repeat < repeats; repeat++) {
      const record = {caseId:testCase.id,category:testCase.category,repeat,status:'cancelled',score:0,passed:false,checks:[]};
      const started = performance.now();
      if (!signal?.aborted) {
        let phase = 'execute';
        try {
          // Expected results and grading rubrics never enter the execution port.
          const observation = jsonValue(await this.execute({input:structuredClone(testCase.input),caseId:testCase.id,repeat,revision,environmentRevision,runId:run.id,signal}));
          record.observation = observation;
          if (signal?.aborted) record.status = 'cancelled';
          else {
            phase = 'grade';
            const grade = jsonValue(await this.grade({testCase:structuredClone(testCase),observation:structuredClone(observation),graderRevision,signal}));
            if (typeof grade.passed !== 'boolean' || !Number.isFinite(grade.score) || grade.score < 0 || grade.score > 1 || !Array.isArray(grade.checks) || grade.checks.some(c => !label(c.name) || typeof c.passed !== 'boolean') || new Set(grade.checks.map(c=>c.name)).size !== grade.checks.length) throw fail('Grader must return passed, score in [0,1] and uniquely named boolean checks');
            Object.assign(record,{status:signal?.aborted?'cancelled':'graded',score:signal?.aborted?0:grade.score,passed:!signal?.aborted&&grade.passed,checks:grade.checks,grade});
          }
        } catch (error) {
          Object.assign(record,{status:signal?.aborted?'cancelled':'error',score:0,passed:false,error:{phase,message:String(error.message).slice(0,4000)}});
        }
      }
      record.durationMs = performance.now() - started;
      run.records.push(record);
      // Evidence sink failures stop the run; losing evidence must not look passed.
      await this.onRecord({runId:run.id,record:structuredClone(record)});
    }
    return run;
  }
}

export function evaluateGate(run, {minimumPassRate = 1, minimumMeanScore = 1, requiredChecks = [], minimumCategoryPassRate = 0} = {}) {
  for (const value of [minimumPassRate,minimumMeanScore,minimumCategoryPassRate]) if (!Number.isFinite(value) || value < 0 || value > 1) throw fail('Evaluation thresholds must be between zero and one');
  if (!Array.isArray(requiredChecks) || requiredChecks.some(c=>!label(c)) || new Set(requiredChecks).size!==requiredChecks.length) throw fail('Required checks must be unique names');
  if (!Number.isInteger(run.expectedRecords) || run.expectedRecords < 1 || !Array.isArray(run.records) || !Array.isArray(run.schedule) || run.schedule.length!==run.expectedRecords) throw fail('Invalid evaluation run');
  const reasons = [], categories = {}, keys = new Set();
  const schedule = new Map(run.schedule.map(item=>[JSON.stringify([item.caseId,item.repeat]),item.category]));
  if (schedule.size!==run.expectedRecords) reasons.push('invalid-schedule');
  let passed = 0, score = 0;
  if (run.records.length !== run.expectedRecords) reasons.push('incomplete-records');
  for (const record of run.records) {
    const id = JSON.stringify([record.caseId,record.repeat]);
    if (keys.has(id)) reasons.push('duplicate-case-repeat');
    if (schedule.get(id)!==record.category) reasons.push('unexpected-case-repeat');
    if (record.status==='cancelled') reasons.push('cancelled-run');
    keys.add(id);
    if (!label(record.category) || !Number.isFinite(record.score) || record.score < 0 || record.score > 1 || !Array.isArray(record.checks)) throw fail('Invalid evaluation record');
    const valid = record.status === 'graded' && record.passed === true;
    const category = Object.hasOwn(categories,record.category) ? categories[record.category] : {total:0,passed:0};
    category.total++; if (valid) category.passed++;
    Object.defineProperty(categories,record.category,{value:category,writable:true,enumerable:true,configurable:true});
    if (valid) passed++;
    score += record.status === 'graded' ? record.score : 0;
    if (requiredChecks.some(name=>!record.checks.some(check=>check.name===name&&check.passed===true))) reasons.push(`required-check:${record.caseId}:${record.repeat}`);
  }
  const passRate = passed/run.expectedRecords, meanScore = score/run.expectedRecords;
  if (passRate < minimumPassRate) reasons.push('pass-rate');
  if (meanScore < minimumMeanScore) reasons.push('mean-score');
  for (const [name,value] of Object.entries(categories)) if (value.passed/value.total < minimumCategoryPassRate) reasons.push(`category:${name}`);
  return {passed:reasons.length===0,passRate,meanScore,categories,reasons};
}

export function compareEvaluations(baseline, candidate) {
  for (const key of ['datasetDigest','graderRevision','environmentRevision','repeats','expectedRecords']) if (baseline[key] !== candidate[key]) throw fail(`Evaluation comparison requires matching ${key}`);
  if (baseline.records.length !== baseline.expectedRecords || candidate.records.length !== candidate.expectedRecords) throw fail('Cannot compare incomplete runs');
  const index = run => new Map(run.records.map(record=>[JSON.stringify([record.caseId,record.repeat]),record]));
  const old = index(baseline), next = index(candidate);
  if (old.size !== baseline.expectedRecords || next.size !== candidate.expectedRecords || [...old.keys()].some(key=>!next.has(key))) throw fail('Evaluation case/repeat coverage differs');
  const regressions = [];
  for (const [key, before] of old) {
    const after = next.get(key);
    if ((before.status==='graded'&&before.passed&&!(after.status==='graded'&&after.passed)) || after.score < before.score || before.checks.some(check=>check.passed&&!after.checks.some(next=>next.name===check.name&&next.passed))) regressions.push({caseId:before.caseId,repeat:before.repeat,before:{status:before.status,score:before.score,passed:before.passed},after:{status:after.status,score:after.score,passed:after.passed}});
  }
  return {baseline:baseline.id,candidate:candidate.id,regressions,noRegressions:regressions.length===0};
}
