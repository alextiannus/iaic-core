import {isDeepStrictEqual} from 'node:util';
import {Notifications} from './service.js';
import {fail} from './store.js';
import {checkedHostBinding,hostProjection} from '../context/host.js';
const text = value => {if(typeof value!=='string'||!value.trim()||value.length>500)throw fail('Wake identifier required');return value;};
const copy = value => structuredClone(value);
const owner = value => {
 if(!value||Object.keys(value).sort().join()!=='scopeId,subjectId')throw fail('Wake requires an explicit Core owner');
 return {scopeId:text(value.scopeId),subjectId:text(value.subjectId)};
};
export function taskWakeIntent(input) {
 const fields=['topic','target','context','capability','taskRequestKey','input','authorityRef'];
 if(!input||Object.keys(input).sort().join()!==fields.sort().join())throw fail('Invalid immutable wake intent');
 const intent={topic:text(input.topic),target:owner(input.target),context:checkedHostBinding(input.context),capability:text(input.capability),taskRequestKey:text(input.taskRequestKey),input:hostProjection(input.input).data,authorityRef:text(input.authorityRef)};
 if(!isDeepStrictEqual(intent.target,intent.context.owner))throw fail('Wake target differs from Host context owner',403);
 return hostProjection(intent).data;
}
// Trusted Host harness. Reuses Notifications for durable intent, attempts and leases;
// does not own a second Task store or execute business actions.
export class TaskWake {
 constructor({store,channel,topics,resolveScope,authorizeEnqueue,authorizeSend,authorizeReconcile,admitTask,findTask,repairBinding,maxAttempts=3}) {
  if(!Array.isArray(topics)||!topics.length||topics.some(t=>{try{text(t);return false;}catch{return true;}})||new Set(topics).size!==topics.length)throw fail('Explicit owned wake topics required');
  if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>10)throw fail('Wake attempt bound must be 1..10');
  for(const port of [resolveScope,authorizeEnqueue,authorizeSend,authorizeReconcile,admitTask,findTask,repairBinding])if(typeof port!=='function')throw fail('Wake Host authorization, admission, receipt and binding ports required');
  if(typeof store?.recoveryPage!=='function')throw fail('Wake recovery paging store required');
  Object.assign(this,{store,channel:text(channel),topics:new Set(topics),resolveScope,authorizeEnqueue,authorizeSend,authorizeReconcile,admitTask,findTask,repairBinding,maxAttempts});
  this.notifications=new Notifications({store,resolveScope,authorize:()=>false,resolveDelivery:job=>this.delivery(job)});
 }
 async enqueue(actor,{requestKey,intent:input}) {
  text(requestKey);const intent=taskWakeIntent(input);
  if(!this.topics.has(intent.topic))throw fail('Wake topic is not owned',403);
  if(await this.authorizeEnqueue(actor,copy(intent))!==true)throw fail('Wake scheduling denied',403);
  return this.store.enqueue(text(await this.resolveScope(copy(intent.target))),{requestKey,recipientId:intent.target.subjectId,channel:this.channel,message:{},source:{kind:'task-wake/v1',intent}});
 }
 async intent(job) {
  if(job.channel!==this.channel||job.source?.kind!=='task-wake/v1')throw fail('Wake channel or source not owned',403);
  const intent=taskWakeIntent(job.source.intent);
  if(!this.topics.has(intent.topic)||job.recipientId!==intent.target.subjectId||job.scopeId!==await this.resolveScope(copy(intent.target)))throw fail('Wake topic or recipient not owned',403);
  return intent;
 }
 match(intent,task) {
  if(!task||typeof task.id!=='string'||!task.id||task.request_key!==intent.taskRequestKey||task.capability!==intent.capability||!isDeepStrictEqual(task.owner,intent.target)||!isDeepStrictEqual(task.input,intent.input)||!isDeepStrictEqual(checkedHostBinding(task.trusted_context),intent.context))throw fail('Task receipt does not match immutable wake',409);
 }
 async bind(intent,task) {
  this.match(intent,task);
  if(await this.authorizeReconcile(copy(intent),copy(task))!==true)throw fail('Wake binding repair denied',403);
  const binding=await this.repairBinding({intent:copy(intent),task:copy(task),idempotencyKey:intent.taskRequestKey});
  if(binding?.bound!==true)throw fail('Task context binding is not verified',409);
  return {status:'delivered',reference:text(task.id),bindingReference:text(binding.reference)};
 }
 async delivery(job) {
  const intent=await this.intent(job);
  return {allowed:true,
   send:async({signal})=>{
    if(signal?.aborted||await this.authorizeSend(copy(intent))!==true)return {status:'not_sent',reason:'wake-admission-currently-denied'};
    if(signal?.aborted)return {status:'not_sent',reason:'wake-stopped-before-admission'};
    const task=await this.admitTask({intent:copy(intent),idempotencyKey:intent.taskRequestKey,signal});
    return this.bind(intent,task);
   },
   query:async()=>{
    // Historical reconciliation has its own policy. It never calls admission,
    // even when current account/context membership no longer permits new Tasks.
    if(await this.authorizeReconcile(copy(intent),null)!==true)throw fail('Wake receipt inspection denied',403);
    const found=await this.findTask({intent:copy(intent),idempotencyKey:intent.taskRequestKey});
    if(found?.status==='found')return this.bind(intent,found.task);
    if(found?.status==='not_sent'&&typeof found.evidenceRef==='string'&&found.evidenceRef.trim()&&found.evidenceRef.length<=500)return {status:'not_sent',reason:'host-proved-no-admission',evidenceRef:found.evidenceRef};
    return {status:'unknown',reason:'wake-admission-unresolved'};
   }};
 }
 async recover(job,{signal}={}) {
  const intent=await this.intent(job);
  if(signal?.aborted)return {id:job.id,state:job.state,skipped:'stopped'};
  if(job.state==='unknown') {
   const delivery=await this.delivery(job);
   return this.store.finish(job,await delivery.query());
  }
  if(job.state==='failed') {
   if(job.result?.status!=='not_sent')return {id:job.id,state:job.state,skipped:'non-send-not-proved'};
   if((await this.store.history(job.scopeId,job.requestKey)).length>=this.maxAttempts)return {id:job.id,state:job.state,skipped:'attempt-limit'};
   // Never turn an automatic recovery sweep into a fresh authority grant.
   if(await this.authorizeSend(copy(intent))!==true)return {id:job.id,state:job.state,skipped:'current-admission-denied'};
   await this.store.control(job.scopeId,job.requestKey,'retry');
  }
  return await this.notifications.tick({channel:this.channel,id:job.id,signal}) ?? {id:job.id,state:job.state,skipped:'claimed-by-other-worker'};
 }
 async pump({after=null,limit=20,signal}={}) {
  await this.store.recoverExpired({channel:this.channel});
  const page=await this.store.recoveryPage({channel:this.channel,after,limit});const results=[];
  for(const job of page.items) {
   try {const result=await this.recover(job,{signal});results.push({id:job.id,state:result.state,...(result.skipped?{skipped:result.skipped}:{})});}
   catch {results.push({id:job.id,state:job.state,error:'wake-recovery-unavailable'});}
  }
  return {results,next:page.next};
 }
}
