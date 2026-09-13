import {createHash} from 'node:crypto';import {jsonValue} from '../evaluation/runner.js';
export const EVENT_SUBSCRIPTION_TASK_PREFIX='event-subscription:';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const requestKey=(key,event)=>EVENT_SUBSCRIPTION_TASK_PREFIX+createHash('sha256').update(JSON.stringify([key,event.id,event.digest])).digest('hex');
// Connect durable feed checkpoints to the existing deferred Task admission.
// No new queue, scheduler, Runtime or business-effect retry loop.
export class EventTaskSubscriptions {
 constructor({subscriptions,deferred,buildTask}){
  if(typeof subscriptions?.read!=='function'||typeof subscriptions?.acknowledge!=='function'||typeof deferred?.schedule!=='function'||typeof deferred?.findRequest!=='function'||typeof deferred?.validateInput!=='function'||!Array.isArray(deferred.reservedPrefixes)||!deferred.reservedPrefixes.includes(EVENT_SUBSCRIPTION_TASK_PREFIX)||typeof buildTask!=='function')throw fail('Event Task subscriptions require feed, deferred authority ports and a reserved request namespace');
  Object.assign(this,{subscriptions,deferred,buildTask});
 }
 async tick(actor,{key,limit=20},{signal}={}){
  signal?.throwIfAborted();const page=await this.subscriptions.read(actor,{key,limit});const handled=[];let cursor=page.cursor;
  try{for(const event of page.items){
   signal?.throwIfAborted();const stableKey=requestKey(key,event),dueAt=new Date(event.publishedAt).toISOString();
   let intent=await this.deferred.findRequest(actor,stableKey);
   if(!intent){
    const input=jsonValue(await this.buildTask(actor,structuredClone(event)));
    if(!input||typeof input!=='object'||Array.isArray(input)||(input.sourceEventKey!==undefined&&input.sourceEventKey!==event.key))throw fail('Host Task plan must preserve the original source event key');
    input.sourceEventKey=event.key;signal?.throwIfAborted();
    intent=await this.deferred.schedule(actor,{requestKey:stableKey,dueAt,input},{internal:true});
   }
   // Recover the original plan, not a new plan under a consumed event key.
   if(!intent||intent.requestKey!==stableKey||intent.dueAt!==dueAt||intent.trigger!==null||intent.input?.sourceEventKey!==event.key||typeof intent.id!=='string')throw fail('Deferred receipt does not match the original event',409);
   await this.deferred.validateInput(actor,intent.input,intent.trigger);
   signal?.throwIfAborted();
   await this.subscriptions.acknowledge(actor,{key,expectedCursor:cursor,cursor:event.sequence});
   cursor=event.sequence;handled.push({eventId:event.id,eventDigest:event.digest,intentId:intent.id,state:intent.state,taskId:intent.taskId});
  }}catch(error){error.eventSubscriptionProgress={key,cursor,handled};throw error;}
  return {key,cursor,handled,hasMore:page.hasMore};
 }
}
