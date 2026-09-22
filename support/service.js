import {fail,text,transitions} from './store.js';
const uuid=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v))throw fail('SUPPORT_INVALID_ID');return v;};
// Ports restore current host authority. Report text never grants engineering access.
export class SupportIssues {
 constructor({store,resolveIdentity,authorize,resolveResolution,notifications,notificationActor}){
  if(!store||typeof resolveIdentity!=='function'||typeof authorize!=='function')throw fail('SUPPORT_PORTS_REQUIRED');
  Object.assign(this,{store,resolveIdentity,authorize,resolveResolution,notifications,notificationActor});
 }
 async identity(actor,action,input){const identity=await this.resolveIdentity(actor);text(identity.scopeId);text(identity.subjectId);if(await this.authorize(actor,{action,input,identity})!==true)throw fail('SUPPORT_ACCESS_DENIED',403);return identity;}
 async report(actor,input){
  const who=await this.identity(actor,'report',input);text(input.requestKey);text(input.summary,2000);
  const report={summary:input.summary};
  // Only bounded references, never raw logs, headers, credentials or private conversations.
  for(const key of ['taskId','requestId','releaseId','errorCode'])if(input[key]!==undefined)report[key]=text(input[key]);
  return this.store.create(who.scopeId,who.subjectId,{requestKey:input.requestKey,report});
 }
 async owned(actor,input,action){uuid(input.id);const who=await this.identity(actor,action,input);const issue=await this.store.get(who.scopeId,input.id);if(!issue)throw fail('SUPPORT_NOT_FOUND',404);if(issue.reporterId!==who.subjectId&&await this.authorize(actor,{action:'manage',input,identity:who,issue})!==true)throw fail('SUPPORT_NOT_FOUND',404);return {who,issue};}
 async get(actor,input){const {who,issue}=await this.owned(actor,input,'read');return {...issue,history:await this.store.history(who.scopeId,issue.id)};}
 async list(actor,input={}){const who=await this.identity(actor,'read',input);return this.store.list(who.scopeId,{reporterId:who.subjectId,limit:input.limit});}
 async queue(actor,input={}){const who=await this.identity(actor,'manage',input);return this.store.list(who.scopeId,{limit:input.limit});}
 async update(actor,input){
  const {who,issue}=await this.owned(actor,input,'update');
  if(!Number.isInteger(input.expectedRevision)||input.expectedRevision<1||!Object.hasOwn(transitions,input.state))throw fail('SUPPORT_INVALID_UPDATE');
  text(input.message,2000);
  const reporterAction=issue.reporterId===who.subjectId&&['closed','reopened'].includes(input.state);
  if(!reporterAction&&await this.authorize(actor,{action:'manage',input,identity:who,issue})!==true)throw fail('SUPPORT_ACCESS_DENIED',403);
  let evidence=null;
  if(input.state==='resolved'){
   if(typeof this.resolveResolution!=='function')throw fail('SUPPORT_RESOLUTION_PORT_REQUIRED',409);
   text(input.evidenceId);
   const result=await this.resolveResolution(input.evidenceId,{actor,issue});
   if(result?.confirmed!==true||result.scopeId!==who.scopeId||result.issueId!==issue.id||result.revision!==input.expectedRevision||result.deployed!==true||result.healthy!==true||result.regressionPassed!==true)throw fail('SUPPORT_RESOLUTION_UNVERIFIED',409);
   // The trusted resolver must verify current deployment and original regression externally.
   evidence={evidenceId:input.evidenceId,releaseId:text(result.releaseId),verificationId:text(result.verificationId)};
   const current=await this.identity(actor,'update',input);
   if(current.scopeId!==who.scopeId||current.subjectId!==who.subjectId||await this.authorize(actor,{action:'manage',input,identity:current,issue})!==true)throw fail('SUPPORT_ACCESS_DENIED',403);
  }
  return this.store.change(who.scopeId,issue.id,{expectedRevision:input.expectedRevision,state:input.state,message:input.message,evidence,actorId:who.subjectId});
 }
 async notify(actor,input){
  const {who,issue}=await this.owned(actor,input,'notify');
  if(await this.authorize(actor,{action:'manage',input,identity:who,issue})!==true)throw fail('SUPPORT_ACCESS_DENIED',403);
  if(!this.notifications||typeof this.notificationActor!=='function')throw fail('SUPPORT_NOTIFICATION_PORT_REQUIRED',409);
  const events=await this.store.history(who.scopeId,issue.id);const event=events.find(e=>e.revision===input.revision);
  if(!event)throw fail('SUPPORT_EVENT_NOT_FOUND',404);
  const sender=await this.notificationActor({actor,identity:who,issue});
  return this.notifications.enqueue(sender,{requestKey:`support:${issue.id}:${event.revision}`,recipientId:issue.reporterId,channel:'support',message:{issueId:issue.id,state:event.state,revision:event.revision,text:event.message},source:{kind:'support-issue',id:issue.id,revision:event.revision}});
 }
}
