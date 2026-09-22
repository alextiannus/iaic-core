import {text} from './store.js';
// Host-owned worker. Delivery ports must durably deduplicate by event identity.
// No watermark: an earlier transaction may become visible after a later one.
export class SupportEventConsumer {
 constructor({store,consumerId,deliver}) {
  if(!store||typeof deliver!=='function')throw new Error('SUPPORT_CONSUMER_PORTS_REQUIRED');
  Object.assign(this,{store,consumerId:text(consumerId),deliver});
 }
 async tick({limit=50}={}) {
  const events=await this.store.pendingEvents(this.consumerId,{limit});
  let acknowledged=0;const failed=[];
  for(const event of events){
   try {
    await this.deliver({...event,requestKey:`support:${event.scopeId}:${event.issueId}:${event.revision}`});
    await this.store.acknowledgeEvent(this.consumerId,event);acknowledged++;
   }catch{failed.push(event);}
  }
  return {acknowledged,failed};
 }
}
