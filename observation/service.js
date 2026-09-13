import {evidenceDigest,jsonValue} from '../evaluation/runner.js';
import {fail,key} from '../releases/store.js';
const integer=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,29})$/.test(v);
const instant=v=>{if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))throw fail('Observation timestamp required');return new Date(v).toISOString();};
export class ReleaseObservation{
 #policies;
 constructor({store,releases,sourceScope,resolveSource,authorize,policies,now=()=>new Date()}){
  if(!store||!releases||typeof resolveSource!=='function'||typeof authorize!=='function')throw fail('Observation requires storage, release, trusted source and authorization ports');
  key(sourceScope);this.#policies=jsonValue(policies);for(const p of Object.values(this.#policies)){key(p.revision);key(p.fallbackId);if(!Number.isInteger(p.minSamples)||p.minSamples<1||!Number.isFinite(p.maxErrorRate)||p.maxErrorRate<0||p.maxErrorRate>1||!Number.isFinite(p.maxMeanLatencyMs)||p.maxMeanLatencyMs<0||!Number.isInteger(p.windowMs)||p.windowMs<1||p.windowMs>604800000||!Number.isInteger(p.maxAssessmentAgeMs)||p.maxAssessmentAgeMs<1||p.maxAssessmentAgeMs>p.windowMs)throw fail('Complete bounded observation policy required');if(p.maxCostMinor!==undefined&&(!integer(p.maxCostMinor)||! /^[A-Z]{3}$/.test(p.currency||'')))throw fail('Cost policy requires currency and integer minor units');}
  Object.assign(this,{store,releases,sourceScope,resolveSource,authorize,now});
 }
 async allowed(actor,action,input){if(await this.authorize(actor,{action,input})!==true)throw fail('Observation access denied',403);}
 policy(channel){const p=this.#policies[key(channel)];if(!p)throw fail('Observation channel policy not configured',404);return p;}
 async record(actor,{sourceId}){
  await this.allowed(actor,'record',{sourceId});const source=await this.resolveSource(key(sourceId),{actor,sourceScope:this.sourceScope});
  if(!source||source.confirmed!==true||source.sourceId!==sourceId||source.sourceScope!==this.sourceScope)throw fail('Observation source is not confirmed for this application',409);
  const r=jsonValue(source.record);key(r.releaseId);if(!/^[a-f0-9]{64}$/.test(r.manifestDigest||'')||typeof r.success!=='boolean'||!Number.isFinite(r.durationMs)||r.durationMs<0||r.durationMs>1e12||!Number.isSafeInteger(r.toolErrors)||r.toolErrors<0||r.toolErrors>1e9||!integer(r.providerTokens)||!integer(r.platformUnits))throw fail('Observation requires release binding, outcome, duration and distinct usage metrics');
  if(r.cost!==undefined&&(!integer(r.cost.minorUnits)||! /^[A-Z]{3}$/.test(r.cost.currency||'')))throw fail('Observation cost must have currency and integer minor units');
  // Trusted sources may report a finished call after its release was stopped.
  return this.store.record({sourceId,releaseId:r.releaseId,manifestDigest:r.manifestDigest,observedAt:instant(r.observedAt),success:r.success,durationMs:r.durationMs,toolErrors:r.toolErrors,providerTokens:r.providerTokens,platformUnits:r.platformUnits,...(r.cost?{cost:r.cost}:{})});
 }
 async assess(actor,{channel,releaseId,manifestDigest}){
  await this.allowed(actor,'assess',{channel,releaseId});const policy=this.policy(channel);await this.releases.check(actor,{releaseId,manifestDigest});
  const assessedAt=instant(new Date(this.now()).toISOString()),until=assessedAt,since=new Date(Date.parse(until)-policy.windowMs).toISOString();
  const {records,truncated}=await this.store.window({releaseId,since,until,limit:10000});
  if(records.some(r=>r.manifestDigest!==manifestDigest))throw fail('Observation manifest bindings differ',409);
  const samples=records.length,errors=records.filter(r=>!r.success).length,toolErrors=records.reduce((n,r)=>n+r.toolErrors,0),meanLatencyMs=samples?records.reduce((n,r)=>n+r.durationMs,0)/samples:null;
  const currencies=[...new Set(records.filter(r=>r.cost).map(r=>r.cost.currency))];const costsComplete=records.every(r=>r.cost)&&currencies.length===1,costApplicable=costsComplete&&currencies[0]===policy.currency;
  const costMinor=records.reduce((n,r)=>n+BigInt(r.cost?.minorUnits||'0'),0n).toString();
  const complete=!truncated&&samples>=policy.minSamples&&(policy.maxCostMinor===undefined||costApplicable);
  const violations=[];if(samples&&errors/samples>policy.maxErrorRate)violations.push('error-rate');if(samples&&meanLatencyMs>policy.maxMeanLatencyMs)violations.push('mean-latency');if(policy.maxCostMinor!==undefined&&costApplicable&&BigInt(costMinor)>BigInt(policy.maxCostMinor))violations.push('monetary-cost');
  const metrics={samples,errors,errorRate:samples?errors/samples:null,toolErrors,meanLatencyMs,providerTokens:records.reduce((n,r)=>n+BigInt(r.providerTokens),0n).toString(),platformUnits:records.reduce((n,r)=>n+BigInt(r.platformUnits),0n).toString(),cost:costsComplete?{currency:currencies[0],minorUnits:costMinor}:null};
  return this.store.putAssessment({channel,releaseId,manifestDigest,since,until,assessedAt,policyDigest:evidenceDigest(policy),sourceDigest:evidenceDigest(records),sourceIds:records.map(r=>r.sourceId),metrics,complete,violations,shouldStop:complete&&violations.length>0});
 }
 async protect(actor,{assessmentId,expectedRevision}){
  await this.allowed(actor,'protect',{assessmentId,expectedRevision});const assessment=await this.store.getAssessment(assessmentId),policy=this.policy(assessment.channel);
  const age=new Date(this.now()).getTime()-Date.parse(assessment.assessedAt);
  if(!assessment.shouldStop||assessment.policyDigest!==evidenceDigest(policy)||!Number.isFinite(age)||age<0||age>policy.maxAssessmentAgeMs)throw fail('Assessment is insufficient, stale or uses another policy',409);
  return this.releases.rollback(actor,{name:assessment.channel,expectedRevision,candidateId:assessment.releaseId,manifestDigest:assessment.manifestDigest,fallbackId:policy.fallbackId,evidence:{assessmentId,sourceDigest:assessment.sourceDigest,policyDigest:assessment.policyDigest,violations:assessment.violations}});
 }
}
