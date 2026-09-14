import {validate,hash,future,fail,same} from './contracts.js';
const view=(task,now)=>({...task,state:['open','claimed'].includes(task.state)&&Date.parse(task.dueAt)<=now?'expired':task.state});
export class PeerHumanTasks{
 constructor({peer}){this.peer=peer;}
 async run(actor,operation,input){if(!operation.startsWith('human.'))throw fail('PEER_OPERATION','Unknown operation');const p=this.peer,i=validate(operation,input);return p.store.transaction(async tx=>{
  const identity=await p.who(actor);
  if(operation==='human.create'){const c=await p.channel(tx,actor,i.channelId);await p.participantOrController(tx,actor,c);await p.permit(actor,operation,{channel:c,input:i});const id=hash([c.id,identity,i.requestKey]),digest=hash(i),old=await tx.get('human',id,false);if(old){if(old.digest!==digest)throw fail('PEER_CONFLICT','Human request key already bound',409);return view(old,p.clock());}const dueAt=future(i.dueAt,p.clock());let attempts=[];if(i.messageId){const m=await tx.get('message',i.messageId);if(m.channelId!==c.id)throw fail('PEER_SCOPE','Message outside channel',403);for(const endpointId of m.recipientEndpointIds)attempts.push(...await tx.outbox.history(c.id,m.id+':'+endpointId));}const task={id,digest,channelId:c.id,subjectRef:c.subjectRef,subjectVersion:c.subjectVersion,owner:c.humanOwner,createdBy:identity,reason:i.reason,allowedActions:i.allowedActions,dueAt,state:'open',messageId:i.messageId??null,attemptRefs:attempts.map(a=>a.attempt),resolution:null};await tx.put('human',id,task);await tx.audit(c.id,operation,identity,{id,reasonHash:hash(i.reason),owner:task.owner});return task;}
  const task=await tx.get('human',i.id),c=await tx.get('channel',task.channelId);await p.permit(actor,operation,{channel:c,task});const owner=identity.tenantId===task.owner.tenantId&&identity.principalId===task.owner.principalId;if(!owner)await p.permit(actor,'human.admin',{channel:c,task});const expired=Date.parse(task.dueAt)<=p.clock();if(operation==='human.get')return view(task,p.clock());
  if(operation==='human.resolve'&&task.state==='resolved'){if(task.resolution.digest!==hash({identity,input:i}))throw fail('PEER_CONFLICT','Human resolution already bound',409);return task;}
  if(expired||!['open','claimed'].includes(task.state))throw fail('PEER_STATE','Human task is no longer open',409);
  if(operation==='human.claim'){if(task.state==='claimed'&&!same(task.claimedBy,identity))throw fail('PEER_CONFLICT','Human task already claimed',409);task.state='claimed';task.claimedBy=identity;}
  else if(operation==='human.cancel')task.state='cancelled';
  else if(operation==='human.resolve'){if(task.claimedBy&&!same(task.claimedBy,identity))throw fail('PEER_IDENTITY','Resolve using the claimant identity',403);if(!task.allowedActions.includes(i.action))throw fail('PEER_SCOPE','Human action not allowed',403);await p.evidence(actor,{...c,subjectVersion:task.subjectVersion},i.evidence);task.state='resolved';task.resolution={action:i.action,evidence:i.evidence,actor:identity,digest:hash({identity,input:i})};}
  await tx.put('human',task.id,task);await tx.audit(c.id,operation,identity,{id:task.id,state:task.state});return task;
 });}
}
