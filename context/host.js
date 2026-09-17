import {createHash} from 'node:crypto';
const fail=(message,statusCode=409)=>Object.assign(new Error(message),{statusCode,code:'HOST_CONTEXT_REJECTED'});
const text=value=>typeof value==='string'&&value.length>0&&value.length<=500;
const owner=actor=>{if(!text(actor?.scopeId)||!text(actor?.subjectId))throw fail('Core owner required',403);return {scopeId:actor.scopeId,subjectId:actor.subjectId};};
const sameOwner=(a,b)=>a?.scopeId===b?.scopeId&&a?.subjectId===b?.subjectId;
function canonical(value,depth=0){
 if(depth>20)throw fail('Host projection exceeds depth bound');
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(Array.isArray(value))return value.map(v=>canonical(v,depth+1));
 if(value&&[Object.prototype,null].includes(Object.getPrototypeOf(value)))return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k],depth+1)]));
 throw fail('Host projection must be plain JSON');
}
export function hostProjection(value){
 if(!value||Array.isArray(value)||typeof value!=='object')throw fail('Host projection must be a JSON object');
 const data=canonical(value),encoded=JSON.stringify(data);
 if(Buffer.byteLength(encoded)>16384)throw fail('Host projection exceeds 16384 bytes');
 return {data,digest:createHash('sha256').update(encoded).digest('hex')};
}
export function checkedHostBinding(value){
 const fields=['source','schema','version','reference','revision','digest','owner'];
 if(!value||Object.keys(value).sort().join()!==fields.sort().join()||value.source!=='host'||!['schema','version','reference','revision'].every(k=>text(value[k]))||! /^[a-f0-9]{64}$/.test(value.digest)||Object.keys(value.owner??{}).sort().join()!=='scopeId,subjectId')throw fail('Invalid Host context binding');
 return {...value,owner:owner(value.owner)};
}
// Host supplies immutable redacted snapshots and current authorization. Core
// stores only their reference/digest; this service never reads user-goal fields.
export class HostTaskContext {
 constructor({bind,resolve,authorize,readTask,restoreActor=null}){
  if([bind,resolve,authorize,readTask].some(port=>typeof port!=='function')||(restoreActor!==null&&typeof restoreActor!=='function'))throw fail('Host context requires trusted binding, resolution, authorization and scoped Task read ports',400);
  Object.assign(this,{bindSource:bind,resolveSource:resolve,authorize,readTask,restore:restoreActor});
 }
 async bind({actor,capability,idempotencyKey,version}){
  const identity=owner(actor);
  const source=await this.bindSource({actor,capability:capability.name,requestKey:idempotencyKey,hostVersion:version});
  const {digest}=hostProjection(source?.projection);
  const binding=checkedHostBinding({source:'host',schema:source.schema,version:source.version,reference:source.reference,revision:source.revision,digest,owner:identity});
  if(await this.authorize({actor,taskId:null,binding:structuredClone(binding)})!==true)throw fail('Host context access denied',403);
  return binding;
 }
 async check({actor,task}){
  const binding=checkedHostBinding(task.trusted_context);
  if(!sameOwner(owner(actor),binding.owner)||await this.authorize({actor,taskId:task.id,binding:structuredClone(binding)})!==true)throw fail('Host context access denied',403);
  return binding;
 }
 async project(request){
  const binding=await this.check(request),value=await this.resolveSource({actor:request.actor,taskId:request.task.id,binding:structuredClone(binding)});
  const {data,digest}=hostProjection(value);
  if(digest!==binding.digest)throw fail('Host context revision or projection changed; original snapshot required');
  return {source:'host',schema:binding.schema,version:binding.version,revision:binding.revision,digest,data};
 }
 async restoreActor({actor,taskId}){
  if(!this.restore||!text(taskId))throw fail('Trusted Task and Host Actor resolver required',403);
  const task=await this.readTask(actor,taskId);
  if(task?.id!==taskId)throw fail('Host Task reference mismatch',403);
  const binding=await this.check({actor,task}),restored=await this.restore({actor,taskId,binding:structuredClone(binding)});
  if(!sameOwner(owner(restored),binding.owner))throw fail('Restored Actor cannot change Core owner',403);
  return restored;
 }
}
