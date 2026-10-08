// IDs originate only from the trusted Runtime event store, never model messages.
export const resultReceipts=history=>history.events.filter(e=>e.kind==='metered_result').map(e=>e.data.billing.requestId);
export function pendingMeteredResult(history){
 for(const event of history.events.filter(e=>e.kind==='metered_result')){
  const id=event.data.billing.requestId;
  const consumed=history.events.some(e=>e.data?.resultRequestId===id&&(
   ['action_batch','outcome','delegation_requested','feedback'].includes(e.kind)||
   (e.kind==='verification'&&e.data.verified===false)));
  if(!consumed)return event.data;
 }
 return null;
}
