import {fail,text} from './store.js';
import {sourceKind} from './observations.js';
import {SupportEventConsumer} from './consumer.js';

// Composition over the original Support and Notification authorities, not a second outbox.
export class SupportFollowUp {
 constructor({support,store,notifications,notificationActor,resolveRead}){
  if(!support||!store||!notifications||typeof notificationActor!=='function')throw fail('SUPPORT_FOLLOW_UP_PORTS_REQUIRED');
  Object.assign(this,{support,store,notifications,notificationActor,resolveRead});
 }
 async context(actor,input){
  if(!Number.isInteger(input.revision)||input.revision<1)throw fail('SUPPORT_INVALID_REVISION');
  const {who,issue}=await this.support.owned(actor,input,'read');
  if((issue.report?.sourceKind??'end_user_reported')!=='end_user_reported')throw fail('SUPPORT_USER_FOLLOW_UP_NOT_APPLICABLE',409);
  const event=(await this.store.history(who.scopeId,issue.id)).find(e=>e.revision===input.revision);
  if(!event)throw fail('SUPPORT_EVENT_NOT_FOUND',404);
  const sender=await this.notificationActor({actor,identity:who,issue});
  const requestKey=`support:${issue.id}:${event.revision}`;
  const job=await this.notifications.get(sender,{requestKey});
  if(job&&(job.scopeId!==who.scopeId||job.requestKey!==requestKey||job.recipientId!==issue.reporterId||job.channel!=='support'||job.source?.kind!=='support-issue'||job.source.id!==issue.id||job.source.revision!==event.revision))throw fail('SUPPORT_FOLLOW_UP_BINDING_MISMATCH',409);
  await this.recheck(actor,input,who);
  return {who,issue,event,job};
 }
 async recheck(actor,input,who){
  const current=await this.support.owned(actor,input,'read');
  if(current.who.scopeId!==who.scopeId||current.who.subjectId!==who.subjectId||sourceKind(current.who)!==sourceKind(who))throw fail('SUPPORT_ACCESS_DENIED',403);
  return current.issue;
 }
 async get(actor,input){
  const {who,issue,event,job}=await this.context(actor,input);
  const receipt=await this.store.readReceipt(who.scopeId,issue.id,event.revision);
  if(receipt&&(!job||job.state!=='delivered'||receipt.notificationId!==job.id||receipt.recipientId!==issue.reporterId))throw fail('SUPPORT_FOLLOW_UP_BINDING_MISMATCH',409);
  const current=await this.recheck(actor,input,who);
  return {issueId:issue.id,revision:event.revision,currentRevision:current.revision,historical:event.revision!==current.revision,recipientId:issue.reporterId,
   admission:job?'admitted':'not_admitted',notificationId:job?.id??null,delivery:job?.state??'not_admitted',
   read:receipt?'read':'not_verified',readAt:receipt?.readAt??null,readEvidenceId:receipt?.evidenceId??null};
 }
 async recordRead(actor,input){
  text(input.evidenceId);
  const {who,issue,event,job}=await this.context(actor,input);
  if(await this.support.authorize(actor,{action:'manage',identity:who,issue,input})!==true)throw fail('SUPPORT_ACCESS_DENIED',403);
  if(!job||job.state!=='delivered')throw fail('SUPPORT_DELIVERY_NOT_VERIFIED',409);
  if(typeof this.resolveRead!=='function')throw fail('SUPPORT_READ_PORT_REQUIRED',409);
  const result=await this.resolveRead(input.evidenceId,{actor,identity:who,issue,revision:event.revision,notificationId:job.id});
  if(result?.confirmed!==true||result.scopeId!==who.scopeId||result.issueId!==issue.id||result.revision!==event.revision||result.recipientId!==issue.reporterId||result.notificationId!==job.id||typeof result.readAt!=='string'||!Number.isFinite(Date.parse(result.readAt)))throw fail('SUPPORT_READ_UNVERIFIED',409);
  await this.recheck(actor,input,who);
  if(await this.support.authorize(actor,{action:'manage',identity:who,issue,input})!==true)throw fail('SUPPORT_ACCESS_DENIED',403);
  await this.store.recordRead(who.scopeId,issue.id,event.revision,{notificationId:job.id,recipientId:issue.reporterId,evidenceId:input.evidenceId,readAt:new Date(result.readAt).toISOString()});
  return this.get(actor,input);
 }
}

// Schedule this trusted worker whenever the Host enables user-reported issue resolution.
// A crash after enqueue leaves the event pending; notify uses the original stable key.
export function createSupportResolutionConsumer({support,store,consumerId,resolveActor,retryDelaySeconds=30}){
 if(typeof resolveActor!=='function')throw fail('SUPPORT_FOLLOW_UP_PORTS_REQUIRED');
 if(!Number.isInteger(retryDelaySeconds)||retryDelaySeconds<1||retryDelaySeconds>3600)throw fail('SUPPORT_INVALID_RETRY_DELAY');
 return new SupportEventConsumer({store,consumerId,retryDelaySeconds,deliver:async event=>{
  if(event.state!=='resolved')return;
  const actor=await resolveActor(event.scopeId);
  const {who,issue}=await support.owned(actor,{id:event.issueId},'notify');
  if(who.scopeId!==event.scopeId||await support.authorize(actor,{action:'manage',identity:who,issue,input:event})!==true)throw fail('SUPPORT_ACCESS_DENIED',403);
  if((issue.report?.sourceKind??'end_user_reported')==='end_user_reported')await support.notify(actor,{id:event.issueId,revision:event.revision});
 }});
}
