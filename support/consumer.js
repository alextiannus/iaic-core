import {text,fail} from './store.js';
// Host-owned worker. Delivery ports must durably deduplicate by event identity.
// No watermark: an earlier transaction may become visible after a later one.
export class SupportEventConsumer {
 constructor({store,consumerId,deliver,retryDelaySeconds=0}) {
  if(!store||typeof deliver!=='function')throw new Error('SUPPORT_CONSUMER_PORTS_REQUIRED');
  if(!Number.isInteger(retryDelaySeconds)||retryDelaySeconds<0||retryDelaySeconds>3600)throw fail('SUPPORT_INVALID_RETRY_DELAY');
  if(retryDelaySeconds>0&&typeof store.deferEvent!=='function')throw fail('SUPPORT_RETRY_STORE_REQUIRED');
  Object.assign(this,{store,consumerId:text(consumerId),deliver,retryDelaySeconds});
 }
 async tick({limit=50}={}) {
  const events=await this.store.pendingEvents(this.consumerId,{limit});
  let acknowledged=0;const failed=[];
  for(const event of events){
   let delivered=false;
   try {
    await this.deliver({...event,requestKey:`support:${event.scopeId}:${event.issueId}:${event.revision}`});
    delivered=true;
    await this.store.acknowledgeEvent(this.consumerId,event);acknowledged++;
   }catch{
    failed.push(event);
    // Lost acknowledgement after successful admission may reconcile immediately.
    // Failed deliveries rotate behind other work and survive worker restarts.
    if(!delivered&&this.retryDelaySeconds>0){try{await this.store.deferEvent(this.consumerId,event,{delaySeconds:this.retryDelaySeconds});}catch{/* Preserve the pending event on storage failure. */}}
   }
  }
  return {acknowledged,failed};
 }
}
