import {evidenceDigest,jsonValue} from '../evaluation/runner.js';
import {meteredModel} from '../billing/metered-model.js';
import {fail} from '../releases/store.js';
const prefix='iaic-delegated-task:';
const same=(a,b)=>evidenceDigest(a)===evidenceDigest(b);
export const delegationExecutorKey=p=>JSON.stringify([p.applicationId,p.subjectId]);
// Shared Runtime hook: durable authorization binding, not a new task engine.
export class DelegatedTasks {
 constructor({grants,ledger,modelPolicy}){if(!grants||!ledger||typeof modelPolicy!=='function')throw fail('Grant, ledger and trusted model policy ports required');Object.assign(this,{grants,ledger,modelPolicy});}
 async current(actor,id){
  const row=await this.grants.access(actor,id,'execute'),terms=row.terms;
  if(row.revoked||Date.parse(terms.deadlineAt)<=Date.now()||!same(await this.grants.principal(actor),terms.delegate))throw fail('Task delegation unavailable',403);
  const issuerActor=await this.grants.restoreActor(terms.issuer);
  if(!same(await this.grants.principal(issuerActor),terms.issuer)||await this.grants.authorizeGrant(issuerActor,{action:'continue',terms})!==true)throw fail('Task issuer authority unavailable',403);
  const t=terms.task,cap=t&&this.grants.dispatcher.capabilities.get(t.capability);
  if(!t||Object.keys(t).some(k=>!['capability','input','budgetId'].includes(k))||typeof t.budgetId!=='string'||!t.budgetId||!cap||cap.implementation.kind!=='agent'||this.grants.dispatcher.validateActor(actor,cap)!==true||this.grants.dispatcher.validateActor(issuerActor,cap)!==true||!cap.validateInput(t.input)||!Array.isArray(t.input.allowedTools)||t.input.allowedTools.some(n=>!terms.tools.includes(n)||!cap.implementation.tools.includes(n))||t.input.delegation!==undefined||await cap.authorize(actor,t.input)!==true||await cap.authorize(issuerActor,t.input)!==true)throw fail('Task grant does not bind a valid narrowed Agent input',403);
  return {row,issuerActor,cap};
 }
 async bind({actor,capability,input,idempotencyKey}){
  if(!idempotencyKey?.startsWith(prefix))return null;
  const id=idempotencyKey.slice(prefix.length),{row}=await this.current(actor,id);
  if(capability.name!==row.terms.task.capability||!same(input,row.terms.task.input))throw fail('Task input differs from approved grant',403);
  return {grantId:id,digest:row.digest};
 }
 async check({actor,task}){
  const {row}=await this.current(actor,task.authority.grantId);
  if(row.digest!==task.authority.digest||task.request_key!==prefix+row.id||task.capability!==row.terms.task.capability||!same(task.input,row.terms.task.input))throw fail('Persistent Task authority binding changed',403);
  return row;
 }
 async model({actor,task,model}){
  const row=await this.check({actor,task});if(model.metered)throw fail('Delegated Task requires an unmetered provider to avoid double charging');
  const config=jsonValue(await this.modelPolicy({actor,task,model,terms:jsonValue(row.terms)}));
  if(!['SYSTEM_MANAGED','BYOK'].includes(config.mode))throw fail('Explicit delegated model credential mode required');
  const wrapped=meteredModel({model,ledger:this.ledger,scope:row.terms.payer,mode:config.mode,policy:{...config.policy,budget:{id:row.terms.task.budgetId,executor:delegationExecutorKey(row.terms.delegate)}}});
  // The current grant is checked again immediately before each inference.
  return {...wrapped,next:async request=>{await this.check({actor,task});return wrapped.next(request);}};
 }
 async checkTool({actor,task,action}){
  const row=await this.check({actor,task}),issuerActor=await this.grants.restoreActor(row.terms.issuer),cap=this.grants.dispatcher.capabilities.get(action.name);
  if(!row.terms.tools.includes(action.name)||!cap||cap.implementation.kind!=='function'||!cap.validateInput(action.input)||await cap.authorize(issuerActor,action.input)!==true||await cap.authorize(actor,action.input)!==true||await this.grants.allowInput({issuerActor,delegateActor:actor,terms:row.terms,capability:action.name,input:action.input})!==true)throw fail('Delegated Task tool exceeds current authority',403);
 }
 async checkContext({actor,task,history}){for(const call of history.calls)if(call.status==='succeeded')await this.checkTool({actor,task,action:{name:call.capability,input:call.input}});}
 async admitTool({actor,task,action,callId}){await this.checkTool({actor,task,action});return this.grants.store.admit(task.authority.grantId,{callId,capability:action.name,inputDigest:evidenceDigest(action.input),effectKey:callId});}
 async settleTool({task,callId,outcome}){return this.grants.store.settled(task.authority.grantId,callId,outcome);}
 async submit(actor,grantId){const {row}=await this.current(actor,grantId);return this.grants.dispatcher.invoke(row.terms.task.capability,row.terms.task.input,{actor,callId:prefix+grantId});}
 async cancel(actor,grantId){
  const row=await this.grants.access(actor,grantId,'revoke');if(!same(await this.grants.principal(actor),row.terms.issuer))throw fail('Only issuer can cancel delegated Task',403);
  if(!row.terms.task)throw fail('Grant has no delegated Task');
  await this.grants.store.revoke(grantId);
  const delegate=await this.grants.restoreActor(row.terms.delegate),runtime=this.grants.dispatcher.tasks;
  const task=await runtime.store.findRequest(delegate,row.terms.task.capability,prefix+grantId);
  if(!task)return {grantId,taskId:null,status:'revoked'};
  if(!same(task.authority,{grantId,digest:row.digest}))throw fail('Cancellation Task binding mismatch',403);
  if(['succeeded','failed','cancelled'].includes(task.status))return {grantId,taskId:task.id,status:task.status};
  const cancelled=await runtime.store.transition(delegate,task.id,{action:'cancel',version:runtime.version});
  return {grantId,taskId:task.id,status:cancelled.status};
 }
}
