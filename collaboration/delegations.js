import Ajv from 'ajv';
import {delegationProposalSchema} from '../agent/delegation.js';
import {evidenceDigest,jsonValue} from '../evaluation/runner.js';
import {fail} from '../releases/store.js';
const validate=new Ajv({strict:true}).compile(delegationProposalSchema);
const same=(a,b)=>evidenceDigest(a)===evidenceDigest(b);
const grantId=id=>{if(typeof id!=='string'||! /^[a-f0-9-]{36}$/i.test(id))throw fail('Delegation intent required');return 'runtime-delegation:'+id;};
const terminal=t=>t&&['succeeded','failed','cancelled'].includes(t.status);
// Adapter for the existing Runtime Delegations loop; all Tasks use its store/executor.
export class CrossPrincipalDelegations {
 constructor({authority,artifacts,resolvePlan,readArtifact}){
  if(!authority?.parents||!artifacts||typeof resolvePlan!=='function'||typeof readArtifact!=='function')throw fail('Delegated Task, parent authority, sharing and trusted planning ports required');
  Object.assign(this,{authority,artifacts,resolvePlan,readArtifact});this.grants=authority.grants;
 }
 get runtime(){return this.grants.dispatcher.tasks;}
 async prepare(actor,parent,request,deadlineAt){
  if(!validate(request)||parent.authority||parent.handoff||!parent.input.delegation||Date.parse(deadlineAt)<=Date.now())throw fail('Invalid bounded delegation proposal');
  const target=this.grants.dispatcher.capabilities.get(parent.input.delegation.capability);
  if(!target||target.implementation.kind!=='agent'||!Array.isArray(parent.input.allowedTools)||request.tools.some(n=>!parent.input.allowedTools.includes(n)||!target.implementation.tools.includes(n)))throw fail('Delegation exceeds parent or target tool scope',403);
  for(const ref of request.artifacts??[]){const value=await this.readArtifact(actor,ref);if(!same(value.reference,ref))throw fail('Delegation input artifact changed',409);}
  const input={goal:request.goal+'\nSuccess criteria: '+request.successCriteria,allowedTools:request.tools,requiredArtifacts:request.requiredArtifacts??[],...(parent.input.mandate?{mandate:parent.input.mandate}:{}),...(request.artifacts?.length?{inputArtifacts:request.artifacts}:{})};
  const plan=jsonValue(await this.resolvePlan({actor,parent:structuredClone(parent),request:jsonValue(request),deadlineAt,input:jsonValue(input)}));
  if(!plan?.input||['goal','allowedTools','requiredArtifacts','mandate','inputArtifacts'].some(k=>JSON.stringify(plan.input[k])!==JSON.stringify(input[k]))||plan.input.delegation!==undefined||!target.validateInput(plan.input))throw fail('Host plan must preserve delegated goal, scope, Mandate and artifact references',403);
  return plan;
 }
 async validateDelegation(actor,parent,request,deadlineAt){await this.prepare(actor,parent,request,deadlineAt);return jsonValue(request);}
 async row(actor,intentId){
  let row;try{row=await this.grants.access(actor,grantId(intentId),'read');}catch(e){if(e.statusCode===404)return null;throw e;}
  if(!same(await this.grants.principal(actor),row.terms.issuer)||row.terms.task?.parent?.delegationId!==intentId)throw fail('Delegation receipt binding mismatch',403);
  return row;
 }
 async receipt(row){
  const delegate=await this.grants.restoreActor(row.terms.delegate);
  if(!same(await this.grants.principal(delegate),row.terms.delegate))throw fail('Delegation receipt principal mismatch',403);
  const task=await this.runtime.store.findRequest(delegate,row.terms.task.capability,'iaic-delegated-task:'+row.id);
  if(task&&(!same(task.authority,{grantId:row.id,digest:row.digest})||!same(task.input,row.terms.task.input)))throw fail('Delegation Task receipt mismatch',403);
  return {id:row.id,state:terminal(task)?'finished':row.revoked?'cancelled':Date.parse(row.terms.deadlineAt)<=Date.now()?'expired':'active',childTaskId:task?.id??null,childStatus:task?.status??null};
 }
 async delegationReceipt(actor,intentId){const row=await this.row(actor,intentId);return row?this.receipt(row):null;}
 async createDelegation(actor,parent){
  const intent=parent.delegation,id=grantId(intent?.id);let row=await this.row(actor,intent.id);
  if(!row){
   const current=await this.runtime.store.controlState(actor,parent.id);
   if(current.status!=='waiting'||current.waiting_reason!=='external_result'||current.delegation?.id!==intent.id||current.delegation.received)throw fail('Original waiting delegation receipt required',409);
   const plan=await this.prepare(actor,current,intent.request,intent.deadlineAt);
   row=await this.grants.issue(actor,{id,delegate:plan.delegate,payer:plan.payer,tools:intent.request.tools,constraints:plan.constraints,deadlineAt:intent.deadlineAt,maxCalls:plan.maxToolCalls,artifacts:intent.request.artifacts??[],task:{capability:current.input.delegation.capability,input:plan.input,budgetId:plan.budgetId,maxModelCalls:current.input.delegation.maxModelCalls,parent:{taskId:current.id,version:current.version,waitingSeq:current.waitingSeq,delegationId:intent.id}}});
  }
  if(row.terms.task.parent.taskId!==parent.id)throw fail('Parent delegation binding mismatch',403);
  const receipt=await this.receipt(row);
  if(receipt.childTaskId||receipt.state!=='active')return receipt;
  await this.authority.submit(await this.grants.restoreActor(row.terms.delegate),id);
  return this.receipt(row);
 }
 async context(actor,taskId){
  const parent=await this.runtime.state(actor,taskId);if(!parent.delegation)return null;
  const row=await this.row(actor,parent.delegation.id);if(!row)return null;
  if(row.terms.task.parent.taskId!==taskId)throw fail('Parent context binding mismatch',403);
  const receipt=await this.receipt(row);let result=null,availability='current';
  if(receipt.childStatus==='succeeded')try{result=(await this.artifacts.result(actor,row.id)).result;}catch(e){if(![403,404].includes(e.statusCode))throw e;availability='unavailable';}
  return {items:[{...receipt,goal:parent.delegation.request.goal,successCriteria:parent.delegation.request.successCriteria,result,availability}],hasMore:false};
 }
 async bind({idempotencyKey}){if(idempotencyKey?.startsWith('iaic-handoff:'))throw fail('Same-owner Handoff adapter is not installed',503);return null;}
 async checkTask({task}){if(task.handoff)throw fail('Same-owner Handoff adapter is not installed',503);}
 async checkTool(args){return this.checkTask(args);}
 async admitModel(args){return this.checkTask(args);}
 async cancelChildren(actor,parentId){const parent=await this.runtime.store.controlState(actor,parentId);if(parent.delegation){const row=await this.row(actor,parent.delegation.id);if(row)await this.authority.cancel(actor,row.id);}}
 async tick(){} // The Runtime already calls authority.tick for durable cancellation.
}
