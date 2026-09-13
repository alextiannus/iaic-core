import {evidenceDigest,jsonValue} from '../evaluation/runner.js';
import {fail} from '../releases/store.js';
const same=(a,b)=>evidenceDigest(a)===evidenceDigest(b);
export class DelegationParents {
 constructor({grants,allowLink}){if(!grants||typeof allowLink!=='function')throw fail('Parent grant and domain-link policy ports required');Object.assign(this,{grants,allowLink});}
 async read(terms){
  const ref=terms.task?.parent;
  if(!ref||Object.keys(ref).some(k=>!['taskId','version','waitingSeq','delegationId'].includes(k))||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(ref.taskId||'')||typeof ref.version!=='string'||!ref.version||! /^[1-9][0-9]{0,18}$/.test(ref.waitingSeq||'')||(ref.delegationId!==undefined&&typeof ref.delegationId!=='string'))throw fail('Exact parent Task, version and waiting receipt required');
  const actor=await this.grants.restoreActor(terms.issuer);
  if(!same(await this.grants.principal(actor),terms.issuer))throw fail('Parent principal changed',403);
  const runtime=this.grants.dispatcher.tasks,parent=await runtime.store.controlState(actor,ref.taskId);
  return {parent,actor,ref,capability:runtime.dispatcher.capabilities.get(parent.capability)};
 }
 waiting({parent,ref}){
  return parent.status==='waiting'&&parent.version===ref.version&&parent.controlSeq===ref.waitingSeq&&
   (ref.delegationId?parent.waiting_reason==='external_result'&&parent.delegation?.id===ref.delegationId&&!parent.delegation.received:parent.waiting_reason==='input'&&!parent.delegation);
 }
 async check({terms,version=null}){
  const state=await this.read(terms),{parent,actor,ref,capability}=state;
  if(!this.waiting(state)||parent.authority||parent.handoff||!capability||capability.implementation.kind!=='agent'||await capability.authorize(actor,parent.input)!==true||(version!==null&&version!==ref.version))throw fail('Parent is no longer waiting under the approved authority/version',403);
  await this.grants.dispatcher.tasks.checkExecution(actor,parent);
  if(!Array.isArray(parent.input.allowedTools)||terms.tools.some(n=>!parent.input.allowedTools.includes(n)||!capability.implementation.tools.includes(n))||await this.allowLink({actor,parent,terms:jsonValue(terms)})!==true)throw fail('Child grant exceeds parent resource/tool authority',403);
  return state;
 }
 async checkTool({terms,action}){
  const {parent,actor,capability}=await this.check({terms});
  await this.grants.dispatcher.tasks.checkMandate(actor,parent,action.name);
  if(!parent.input.allowedTools.includes(action.name)||(capability.implementation.allowCall&&await capability.implementation.allowCall(parent.input,action,{actor,task:parent})!==true))throw fail('Child tool exceeds parent domain restrictions',403);
 }
 async isClosed(terms){try{return !this.waiting(await this.read(terms));}catch(error){if(error.statusCode===404)return true;throw error;}}
}
