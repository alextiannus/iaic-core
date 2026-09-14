import {defineCapability} from '../capabilities/index.js';
import {compareEvaluations,evidenceDigest,jsonValue} from './runner.js';

// Host authorization applies to each evidence artifact, including both sides of
// a comparison. This adapter supplies no grading, editing or release authority.
export function createEvaluationCapabilities({readEvaluation,authorize,prefix='evaluations'}) {
  if(typeof readEvaluation!=='function'||typeof authorize!=='function')throw new Error('Evaluation capabilities require reader and authorization ports');
  const id={type:'string',pattern:'^[a-zA-Z0-9_-]{1,100}$'};
  const definitions=[
    ['read',{id},['id'],input=>[input.id],'Read retained evaluation evidence and its content digest under current artifact authorization. Does not execute or alter an evaluation.'],
    ['compare',{baselineId:id,candidateId:id},['baselineId','candidateId'],input=>[input.baselineId,input.candidateId],'Compare retained baseline and candidate evidence with matching dataset, grader, environment and case coverage. Reports regressions; does not approve a release or change grading policy.']
  ];
  return definitions.map(([action,properties,required,ids,description])=>{
    const check=async(actor,keys)=>{
      for(const key of new Set(keys))if(await authorize(actor,{id:key})!==true)throw Object.assign(new Error('Evaluation evidence access denied'),{statusCode:403});
    };
    const execute=async(input,{actor})=>{
      const keys=ids(input);
      await check(actor,keys);
      const runs=[];
      for(const key of keys){
        const run=jsonValue(await readEvaluation(actor,key));
        if(run?.id!==key)throw new Error('Evaluation reader returned a different run');
        runs.push(run);
      }
      await check(actor,keys);
      const references=runs.map(run=>({id:run.id,digest:evidenceDigest(run)}));
      return action==='read'?{...references[0],run:runs[0]}:{baseline:references[0],candidate:references[1],comparison:compareEvaluations(...runs)};
    };
    return defineCapability({name:prefix+'.'+action,description,
      input:{type:'object',properties,required,additionalProperties:false},output:{type:'object'},effect:'read',
      authorize:async(actor,input)=>{await check(actor,ids(input));return true;},
      revalidate:(input,_previous,context)=>execute(input,context),implementation:{kind:'function',execute}});
  });
}
