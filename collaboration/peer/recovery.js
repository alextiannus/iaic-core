// Optional host-driven recovery step; uses the existing outbox worker, no new queue.
export class PeerDeliveryRecovery{
 constructor({peer,humans,resolveEscalation}){if(!peer||!humans||typeof resolveEscalation!=='function')throw Error('Peer recovery requires human escalation policy');Object.assign(this,{peer,humans,resolveEscalation});}
 async tick(options={}){
  const delivery=await this.peer.tick(options);
  const problems=await this.peer.store.problems(50),escalations=[];
  for(let job of problems){const context=await this.peer.store.transaction(async tx=>{const c=await tx.get('channel',job.channelId),current=await tx.outbox.get(c.id,job.requestKey),history=await tx.outbox.history(c.id,job.requestKey);if(!current||!['unknown','failed'].includes(current.state)||current.state==='failed'&&history.length<c.maxAttempts)return null;job={...job,state:current.state};return {channel:c,job,history};});if(!context)continue;
   // The policy returns stable requestKey/dueAt and a currently authorized actor.
   const next=await this.resolveEscalation(context);if(!next)continue;
   const task=await this.humans.run(next.actor,'human.create',{...next.input,channelId:context.channel.id,messageId:job.messageId});
   await this.peer.store.transaction(tx=>tx.put('delivery-escalation',job.deliveryId,{humanTaskId:task.id}));escalations.push(task);
  }return {delivery,escalations};
 }
}
