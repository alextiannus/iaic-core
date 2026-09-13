// Reconstruct one finite plan from durable events and original call receipts.
// A failed step abandons unexecuted steps; an unknown step is handled by Runtime.
export function pendingBatch(history){
 const event=history.events.filter(e=>e.kind==='action_batch').at(-1);
 if(!event)return null;
 const {id,actions}=event.data;
 if(history.events.some(e=>e.kind==='action_batch_closed'&&e.data.id===id))return null;
 if(typeof id!=='string'||!Array.isArray(actions)||actions.length<2||actions.length>8)throw new Error('Invalid durable action batch');
 for(let i=0;i<actions.length;i++){
  const reference=id+':'+i,call=history.calls.find(c=>c.action_ref===reference);
  if(!call)return {id,action:actions[i],reference};
  if(call.status==='failed')return {id,closeReason:'step_failed'};
  if(call.status!=='succeeded')throw new Error('Action batch has an unresolved original call');
 }
 return {id,closeReason:'completed'};
}
