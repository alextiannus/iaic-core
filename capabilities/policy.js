const fail=(message,code,statusCode=503,details={})=>Object.assign(new Error(message),{code,statusCode,...details});
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

// Policy is an additional execution ceiling. Authentication and Capability
// authorization remain mandatory and are not delegated to this module.
export class ExecutionPolicy {
 constructor({decide,record}){
  if(typeof decide!=='function'||typeof record!=='function')throw new Error('Execution policy requires decision and durable recording ports');
  this.decide=decide;this.record=record;
 }
 async check({actor,capability,input,phase,taskId=null,callId=null}){
  if(!['admission','agent','function'].includes(phase))throw fail('Invalid policy execution phase','EXECUTION_POLICY_INVALID');
  const descriptor={name:capability.name,kind:capability.implementation.kind,effect:capability.effect};
  const request=freeze(structuredClone({actor,capability:descriptor,input,phase,taskId,callId}));
  const value=await this.decide(request);
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).some(k=>!['allowed','revision','reason','risk'].includes(k))||typeof value.allowed!=='boolean'||!text(value.revision,200)||!text(value.reason,1000)||(value.risk!==undefined&&!text(value.risk,100)))throw fail('Invalid execution policy decision','EXECUTION_POLICY_INVALID');
  const decision=freeze(structuredClone(value));
  // Do not copy arbitrary input payloads into the audit record. The host recorder
  // owns actor attribution, persistence and retention under its access rules.
  const receipt=await this.record(freeze({actor:request.actor,capability:request.capability,phase,taskId,callId,decision}));
  if(!receipt||!text(receipt.id,500))throw fail('Execution policy decision was not recorded','EXECUTION_POLICY_UNRECORDED');
  const result=Object.freeze({...decision,recordId:receipt.id});
  if(!decision.allowed)throw fail('Execution denied by current policy','EXECUTION_POLICY_DENIED',403,{policyDecision:result});
  return result;
 }
}
