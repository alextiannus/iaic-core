import {createHash} from 'node:crypto';
import {evaluateGate,compareEvaluations,evidenceDigest,jsonValue} from '../evaluation/runner.js';
import {fail,key} from './store.js';
function manifest(value){value=jsonValue(value);key(value.id);key(value.implementationRevision);for(const part of ['prompt','model','skills','tools','knowledge','harness'])key(value.versions?.[part]);return value;}
export class ReleaseManager{
 #policies;
 constructor({store,evaluations,policies,authorize,resolveCohort}){
  if(!store||typeof evaluations?.get!=='function'||typeof authorize!=='function'||typeof resolveCohort!=='function')throw fail('Release manager requires persistence, evidence, policy and cohort ports');
  this.#policies=jsonValue(policies);
  for(const name of ['capability','regression']){const p=this.#policies[name];if(!p||!Number.isInteger(p.repeats)||p.repeats<1)throw fail('Both evaluation suite policies are required');for(const field of ['datasetDigest','graderRevision','environmentRevision'])key(p[field]);}
  Object.assign(this,{store,evaluations,authorize,resolveCohort});
 }
 async allowed(actor,action,input){if(await this.authorize(actor,{action,input})!==true)throw fail('Release operation denied',403);return key(actor?.subjectId);}
 async register(actor,{manifest:definition,evaluations}){
  const actorRef=await this.allowed(actor,'register',{id:definition?.id}),value=manifest(definition),evidence={};
  for(const name of ['capability','regression']){
   const policy=this.#policies[name],run=await this.evaluations.get(key(evaluations?.[name]));
   if(run.revision!==value.implementationRevision||['datasetDigest','graderRevision','environmentRevision','repeats'].some(field=>run[field]!==policy[field]))throw fail('Evaluation does not match the candidate and frozen suite policy',409);
   const gate=evaluateGate(run,policy.thresholds);if(!gate.passed)throw fail('Candidate failed the '+name+' evaluation gate',409);
   const comparison=policy.baselineId?compareEvaluations(await this.evaluations.get(policy.baselineId),run):null;
   if(comparison&&!comparison.noRegressions)throw fail('Candidate regressed against the frozen baseline',409);
   evidence[name]={id:run.id,digest:evidenceDigest(run),gate,comparison};
  }
  return this.store.register({manifest:value,manifestDigest:evidenceDigest(value),policy:this.#policies,policyDigest:evidenceDigest(this.#policies),evaluations:evidence},actorRef);
 }
 async setChannel(actor,input){return this.store.setChannel(input,await this.allowed(actor,'setChannel',input));}
 async stop(actor,id){return this.store.stop(id,await this.allowed(actor,'stop',{id}));}
 async rollback(actor,input){return this.store.rollback(input,await this.allowed(actor,'rollback',input));}
 async rollbackReceipt(actor,input){await this.allowed(actor,'rollbackReceipt',input);const receipt=await this.store.rollbackReceipt(input);await this.allowed(actor,'rollbackReceipt',input);return receipt;}

 async history(actor,input){await this.allowed(actor,'history',input);return this.store.history(input);}
 async channel(actor,name){await this.allowed(actor,'channel',{name});return this.store.channel(name);}
 async resolve(actor,name){
  await this.allowed(actor,'resolve',{name});const current=await this.store.channel(name);if(!current)throw fail('Release channel not configured',404);
  let selected='stable',id=current.stableId;
  if(current.canaryId){const cohort=key(await this.resolveCohort(actor,{channel:name}));const bucket=createHash('sha256').update(JSON.stringify([name,current.canaryId,cohort])).digest().readUInt32BE(0)%10000;
   if(bucket<current.percentage*100){const candidate=await this.store.get(current.canaryId);if(candidate&&!candidate.disabled){id=current.canaryId;selected='canary';}}
  }
  const result=await this.store.get(id);if(!result||result.disabled)throw fail('Selected release is unavailable or stopped',409);
  return {channel:name,channelRevision:current.revision,selected,releaseId:id,manifestDigest:result.record.manifestDigest,manifest:result.record.manifest};
 }
 async check(actor,reference){await this.allowed(actor,'check',{releaseId:reference?.releaseId});const result=await this.store.get(key(reference?.releaseId));if(!result||result.disabled||result.record.manifestDigest!==reference.manifestDigest)throw fail('Pinned release is stopped or its manifest differs',409);return result.record.manifest;}
}
