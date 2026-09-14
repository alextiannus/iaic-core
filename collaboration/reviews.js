import {defineCapability} from '../capabilities/index.js';
import {evidenceDigest,jsonValue} from '../evaluation/runner.js';

const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const same=(a,b)=>evidenceDigest(a)===evidenceDigest(b);
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
const reference={type:'object',properties:{path:{type:'string',minLength:1,maxLength:300},revision:{type:'integer',minimum:1},digest:{type:'string',pattern:'^[a-f0-9]{64}$'}},required:['path','revision','digest'],additionalProperties:false};

// Composition over Workspace, not a second review database or approval engine.
// Supply a dedicated service-owned workspace, inaccessible to ordinary writers.
export class WorkspaceReviewStore {
 constructor({workspace,actor}){this.workspace=workspace;this.actor=actor;}
 async get(key){
  if(!id(key))throw fail('Invalid review ID');
  const document=await this.workspace.read(this.actor,{path:'reviews/'+key+'.json',revision:1});
  return JSON.parse(document.content);
 }
 async put(record){
  if(!id(record.id))throw fail('Invalid review ID');
  try{await this.workspace.write(this.actor,{path:'reviews/'+record.id+'.json',content:JSON.stringify(record),mediaType:'application/json',expectedRevision:0});}
  catch(error){
   if(error.statusCode!==409)throw error;
   if(!same(await this.get(record.id),record))throw fail('Review ID already binds different evidence',409);
  }
  return record;
 }
}

export class PeerReviews {
 constructor({store,readArtifact,resolvePrincipal,authorize}){
  if(typeof store?.get!=='function'||typeof store?.put!=='function'||[readArtifact,resolvePrincipal,authorize].some(p=>typeof p!=='function'))throw fail('Review storage, current artifact reader, principal and policy ports required');
  Object.assign(this,{store,readArtifact,resolvePrincipal,authorize});
 }
 async check(actor,action,review){
  if(await this.authorize(actor,{action,review:jsonValue(review)})!==true)throw fail('Peer review access denied',403);
 }
 async target(actor,target){
  if(!target||Object.keys(target).some(key=>!['path','revision','digest'].includes(key))||typeof target.path!=='string'||!target.path||target.path.length>300||!Number.isSafeInteger(target.revision)||target.revision<1||! /^[a-f0-9]{64}$/.test(target.digest||''))throw fail('Exact artifact reference required');
  const artifact=await this.readArtifact(actor,target);
  if(!same(artifact?.reference,target)||typeof artifact.author!=='string'||!artifact.author)throw fail('Exact artifact and trusted author required',409);
  return artifact.author;
 }
 async read(actor,key){
  if(!id(key))throw fail('Invalid review ID');
  await this.check(actor,'read',{id:key});
  const record=jsonValue(await this.store.get(key));
  if(record.id!==key)throw fail('Review reader returned another record',409);
  await this.check(actor,'read',record);
  if(await this.target(actor,record.target)!==record.author)throw fail('Artifact author binding changed',409);
  await this.check(actor,'read',record);
  return record;
 }
 async record(actor,input){
  if(!id(input.id)||!['changes_requested','no_findings','inconclusive'].includes(input.verdict)||typeof input.findings!=='string'||!input.findings.trim()||input.findings.length>16000)throw fail('Review ID, verdict and findings required');
  const reviewer=await this.resolvePrincipal(actor);
  if(typeof reviewer!=='string'||!reviewer)throw fail('Trusted reviewer identity required',403);
  const record=jsonValue({id:input.id,target:input.target,reviewer,verdict:input.verdict,findings:input.findings,previousReviewId:input.previousReviewId??null});
  await this.check(actor,'record',record);
  record.author=await this.target(actor,record.target);
  if(record.author===reviewer)throw fail('Peer review requires another author',409);
  if(record.previousReviewId!==null){
   if(!id(record.previousReviewId))throw fail('Invalid prior review ID');
   const previous=await this.read(actor,record.previousReviewId);
   if(previous.id===record.id||previous.author!==record.author||previous.target.path!==record.target.path||previous.target.revision>record.target.revision)throw fail('Follow-up must reference an earlier review of this author and artifact',409);
  }
  await this.check(actor,'record',record);
  // Put must atomically bind the ID to these exact bytes/fields. No inferred pass.
  const saved=await this.store.put(record);
  if(!same(saved,record))throw fail('Review writer returned different evidence',409);
  await this.check(actor,'read',record);
  return record;
 }
}

export function createPeerReviewCapabilities({reviews,prefix='collaboration.reviews'}){
 const key={type:'string',pattern:'^[a-zA-Z0-9_-]{1,100}$'};
 return [
  defineCapability({name:prefix+'.record',description:'Record peer findings for an exact artifact revision under your own identity. Link a follow-up to the prior review. No finding or verdict is a release approval.',input:{type:'object',properties:{id:key,target:reference,verdict:{type:'string',enum:['changes_requested','no_findings','inconclusive']},findings:{type:'string',minLength:1,maxLength:16000},previousReviewId:key},required:['id','target','verdict','findings'],additionalProperties:false},output:{type:'object'},effect:'write',retry:'idempotent',authorize:async()=>true,revalidate:(input,_result,{actor})=>reviews.read(actor,input.id),implementation:{kind:'function',execute:(input,{actor})=>reviews.record(actor,input)}}),
  defineCapability({name:prefix+'.read',description:'Read retained peer-review evidence under current artifact and review authorization. The review applies to its pinned revision, not a later revision.',input:{type:'object',properties:{id:key},required:['id'],additionalProperties:false},output:{type:'object'},effect:'read',authorize:async()=>true,revalidate:(input,_result,{actor})=>reviews.read(actor,input.id),implementation:{kind:'function',execute:(input,{actor})=>reviews.read(actor,input.id)}})
 ];
}
