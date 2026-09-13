const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export const delegationPolicySchema={type:'object',properties:{capability:{type:'string',minLength:1},maxModelCalls:{type:'integer',minimum:1,maximum:100},timeoutMs:{type:'integer',minimum:1000,maximum:3600000}},required:['capability','maxModelCalls','timeoutMs'],additionalProperties:false};
const reference={type:'object',properties:{path:{type:'string',minLength:1,maxLength:300},revision:{type:'integer',minimum:1},digest:{type:'string',pattern:'^[a-f0-9]{64}$'}},required:['path','revision','digest'],additionalProperties:false};
const proposal={type:'object',properties:{goal:{type:'string',minLength:1,maxLength:4000},successCriteria:{type:'string',minLength:1,maxLength:2000},tools:{type:'array',items:{type:'string'},maxItems:100,uniqueItems:true},artifacts:{type:'array',items:reference,maxItems:20},requiredArtifacts:{type:'array',items:{type:'string',minLength:1,maxLength:300},maxItems:20,uniqueItems:true}},required:['goal','successCriteria','tools'],additionalProperties:false};
// One child intent, executed by the same Runtime. No separate queue or executor.
export class Delegations {
 constructor({store,handoffs,version,authorizeTask,clock=()=>Date.now(),logger=console}){Object.assign(this,{store,handoffs,version,authorizeTask,clock,logger});this.cursor=null;}
 policy(input){
  const p=input.delegation;if(p===undefined)return null;
  if(!this.handoffs||!p||Object.keys(p).some(k=>!['capability','maxModelCalls','timeoutMs'].includes(k))||typeof p.capability!=='string'||!p.capability||!Number.isInteger(p.maxModelCalls)||p.maxModelCalls<1||p.maxModelCalls>100||!Number.isInteger(p.timeoutMs)||p.timeoutMs<1000||p.timeoutMs>3600000||!Array.isArray(input.allowedTools))throw fail('Delegation requires a target, bounded model admissions, deadline and explicit parent tool scope');
  return p;
 }
 schema(task){return this.policy(task.input)&&!task.handoff&&!task.delegation?{...proposal,properties:{...proposal.properties,tools:{...proposal.properties.tools,items:{type:'string',...(task.input.allowedTools.length?{enum:task.input.allowedTools}:{})},maxItems:task.input.allowedTools.length}}}:undefined;}
 async prepare(actor,task,request){
  if(!this.schema(task))throw fail('Delegation is not available for this Task');
  const deadlineAt=new Date(this.clock()+task.input.delegation.timeoutMs).toISOString();
  return {request:await this.handoffs.validateDelegation(actor,task,request,deadlineAt),deadlineAt};
 }
 async tick(){
  if(!this.handoffs)return null;
  let task=await this.store.pendingDelegation(this.version,this.cursor);
  if(!task&&this.cursor){this.cursor=null;task=await this.store.pendingDelegation(this.version);}
  if(!task)return null;this.cursor=task.id;
  try{
   const actor=this.store.actor(task);this.policy(task.input);await this.authorizeTask(actor,task);
   const existing=await this.handoffs.delegationReceipt(actor,task.delegation.id);
   let receipt;
   if(!existing&&Date.parse(task.delegation.deadlineAt)<=this.clock())receipt={state:'expired',childTaskId:null};
   else {
    const current=existing;
    const result=current&&['finished','expired','cancelled'].includes(current.state)?current:await this.handoffs.createDelegation(actor,task);
    if(!['succeeded','failed','cancelled'].includes(result.childStatus)&&!(!result.childTaskId&&['expired','cancelled'].includes(result.state)))return null;
    receipt={handoffId:result.id,state:result.state,childTaskId:result.childTaskId,childStatus:result.childStatus};
   }
   return await this.store.receiveDelegation(actor,task.id,{version:this.version,delegationId:task.delegation.id,receipt});
  }catch(error){this.logger.warn('Delegation remains pending',{taskId:task.id,statusCode:error.statusCode||500});return null;}
 }
}
