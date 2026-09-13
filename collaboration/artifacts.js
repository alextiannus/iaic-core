import {createHash} from 'node:crypto';
import {evidenceDigest,jsonValue} from '../evaluation/runner.js';
import {defineCapability} from '../capabilities/index.js';
import {fail} from '../releases/store.js';
const same=(a,b)=>evidenceDigest(a)===evidenceDigest(b);
const reference=v=>{if(!v||Object.keys(v).some(k=>!['path','revision','digest'].includes(k))||typeof v.path!=='string'||!v.path||v.path.length>300||!Number.isSafeInteger(v.revision)||v.revision<1||! /^[a-f0-9]{64}$/.test(v.digest||''))throw fail('Exact Artifact reference required');return jsonValue(v);};
export class DelegationArtifacts {
 constructor({grants,readOwned,authorizeShare,maxBytes=256000}){if(!grants||typeof readOwned!=='function'||typeof authorizeShare!=='function'||!Number.isInteger(maxBytes)||maxBytes<1)throw fail('Artifact owner-read and current sharing policy ports required');Object.assign(this,{grants,readOwned,authorizeShare,maxBytes});}
 async grant(actor,id){const row=await this.grants.access(actor,id,'read');if(row.revoked)throw fail('Artifact grant revoked',403);return row;}
 async task(row){
  if(!row.terms.task)throw fail('Grant has no Task',404);
  const delegate=await this.grants.restoreActor(row.terms.delegate),runtime=this.grants.dispatcher.tasks;
  const task=await runtime.store.findRequest(delegate,row.terms.task.capability,'iaic-delegated-task:'+row.id);
  if(!task)return null;
  if(!same(task.authority,{grantId:row.id,digest:row.digest}))throw fail('Artifact Task authority mismatch',403);
  // Revalidate current Task/source access before projecting successful outputs.
  return task.status==='succeeded'?runtime.get(delegate,task.id):task;
 }
 async source(actor,row,owner,ref){
  const ownerRef=row.terms[owner],ownerActor=await this.grants.restoreActor(ownerRef);
  if(!same(await this.grants.principal(ownerActor),ownerRef)||await this.authorizeShare({action:'artifact',ownerActor,recipientActor:actor,grant:jsonValue(row.terms),owner,reference:ref})!==true)throw fail('Current Artifact sharing access denied',403);
  const value=await this.readOwned(ownerActor,ref);
  if(!value||!value.reference||!same(value.reference,ref)||typeof value.content!=='string'||Buffer.byteLength(value.content)>this.maxBytes||createHash('sha256').update(value.content).digest('hex')!==ref.digest)throw fail('Shared Artifact content or reference changed',409);
  return {grantId:row.id,owner,reference:ref,mediaType:value.mediaType,bytes:Buffer.byteLength(value.content),content:value.content};
 }
 async read(actor,{grantId,owner,reference:inputRef}){
  const row=await this.grant(actor,grantId),ref=reference(inputRef);
  if(!['issuer','delegate'].includes(owner))throw fail('Artifact owner role required');
  const task=owner==='delegate'?await this.task(row):null;
  const refs=owner==='issuer'?(row.terms.artifacts??[]):(task?.status==='succeeded'?(task.result?.artifacts??[]):[]);
  if(!Array.isArray(refs)||!refs.some(r=>same(reference(r),ref)))throw fail('Artifact is outside the grant input or completed Task result',403);
  return this.source(actor,row,owner,ref);
 }
 async result(actor,grantId){
  const row=await this.grant(actor,grantId),task=await this.task(row);
  if(!task)return {grantId,taskId:null,status:'not_submitted',result:null};
  if(task.status!=='succeeded')return {grantId,taskId:task.id,status:task.status,result:null};
  const ownerActor=await this.grants.restoreActor(row.terms.delegate);
  if(!same(await this.grants.principal(ownerActor),row.terms.delegate)||await this.authorizeShare({action:'result',ownerActor,recipientActor:actor,grant:jsonValue(row.terms),taskId:task.id})!==true)throw fail('Current result sharing access denied',403);
  const refs=task.result?.artifacts??[];if(!Array.isArray(refs)||refs.length>100)throw fail('Bounded Artifact result references required');
  for(const value of refs)await this.source(actor,row,'delegate',reference(value));
  // No transcripts, source metadata or cached Artifact bodies are projected.
  return {grantId,taskId:task.id,status:task.status,result:{summary:typeof task.result?.summary==='string'?task.result.summary.slice(0,8000):'',artifacts:refs.map(reference)}};
 }
}
export function createDelegationArtifactCapabilities({artifacts}){
 const ref={type:'object',properties:{path:{type:'string'},revision:{type:'integer',minimum:1},digest:{type:'string',pattern:'^[a-f0-9]{64}$'}},required:['path','revision','digest'],additionalProperties:false};
 const defs=[['collaboration.artifact.read',{type:'object',properties:{grantId:{type:'string',minLength:1},owner:{enum:['issuer','delegate']},reference:ref},required:['grantId','owner','reference'],additionalProperties:false},(a,i)=>artifacts.read(a,i)],['collaboration.task.result',{type:'object',properties:{grantId:{type:'string',minLength:1}},required:['grantId'],additionalProperties:false},(a,i)=>artifacts.result(a,i.grantId)]];
 return defs.map(([name,input,read])=>defineCapability({name,description:'Read currently shared delegated work through its exact grant and source references.',input,output:{type:'object'},effect:'read',authorize:async()=>true,revalidate:(i,_r,c)=>read(c.actor,i),implementation:{kind:'function',execute:(i,c)=>read(c.actor,i)}}));
}
