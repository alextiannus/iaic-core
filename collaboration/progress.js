import {evidenceDigest,jsonValue} from '../evaluation/runner.js';
import {defineCapability} from '../capabilities/index.js';
import {fail} from '../releases/store.js';
const same=(a,b)=>evidenceDigest(a)===evidenceDigest(b);
// A current metadata projection, not permission to replay or transfer execution.
export class DelegationProgress {
 constructor({grants,authorizeShare}){
  if(!grants||typeof authorizeShare!=='function')throw fail('Grant and current progress sharing policy required');
  Object.assign(this,{grants,authorizeShare});
 }
 async read(actor,grantId){
  const row=await this.grants.access(actor,grantId,'read');
  if(!row.terms.task)throw fail('Grant has no Task',404);
  const ownerActor=await this.grants.restoreActor(row.terms.delegate);
  if(!same(await this.grants.principal(ownerActor),row.terms.delegate)||await this.authorizeShare({action:'progress',ownerActor,recipientActor:actor,grant:jsonValue(row.terms),revoked:row.revoked})!==true)throw fail('Current progress sharing access denied',403);
  const store=this.grants.dispatcher.tasks.store;
  const task=await store.findRequest(ownerActor,row.terms.task.capability,'iaic-delegated-task:'+row.id);
  if(!task)return {grantId,taskId:null,status:'not_submitted',operations:[],requiresReconciliation:false};
  if(!same(task.authority,{grantId:row.id,digest:row.digest})||!same(task.input,row.terms.task.input))throw fail('Progress Task binding mismatch',403);
  if(typeof store.operationReceipts!=='function')throw fail('Task operation receipt adapter required',503);
  const operations=await store.operationReceipts(ownerActor,task.id);
  if(!Array.isArray(operations)||operations.length>1000)throw fail('Bounded operation receipts required',413);
  const projected=operations.map(o=>{
   if(typeof o.effectKey!=='string'||typeof o.capability!=='string'||!['read','write'].includes(o.effect)||!['prepared','running','unknown','failed','succeeded'].includes(o.status))throw fail('Invalid operation receipt',503);
   return {effectKey:o.effectKey,capability:o.capability,effect:o.effect,status:o.status};
  });
  return {grantId,taskId:task.id,status:task.status,operations:projected,requiresReconciliation:projected.some(o=>o.effect!=='read'&&o.status!=='succeeded')};
 }
}
export function createDelegationProgressCapability({progress}){
 return defineCapability({name:'collaboration.task.progress',description:'Read currently shared original operation identifiers before continuing delegated work. Cancellation or failure does not prove an effect did not occur.',input:{type:'object',properties:{grantId:{type:'string',minLength:1}},required:['grantId'],additionalProperties:false},output:{type:'object'},effect:'read',authorize:async()=>true,revalidate:(i,_r,c)=>progress.read(c.actor,i.grantId),implementation:{kind:'function',execute:(i,c)=>progress.read(c.actor,i.grantId)}});
}
