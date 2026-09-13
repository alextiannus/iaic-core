import {fail} from './store.js';
const prefix='iaic-handoff:';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const terminal=task=>['succeeded','failed','cancelled'].includes(task.status);
const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const same=(a,b)=>canonical(a)===canonical(b);
const ref=v=>v&&typeof v.path==='string'&&v.path.length<=300&&Number.isInteger(v.revision)&&v.revision>0&&/^[a-f0-9]{64}$/.test(v.digest)&&Object.keys(v).every(k=>['path','revision','digest'].includes(k));
export class TaskHandoffs {
 constructor({store,resolveScope,restoreActor,readTask,readTaskState,admitTask,findTask,cancelTask,capabilityFor,readArtifact,attenuateInput,authorize,clock=()=>Date.now(),logger=console}){
  for(const port of [resolveScope,restoreActor,readTask,readTaskState,admitTask,findTask,cancelTask,capabilityFor,readArtifact,attenuateInput,authorize])if(typeof port!=='function')throw fail('Handoff host ports are required',400);
  Object.assign(this,{store,resolveScope,restoreActor,readTask,readTaskState,admitTask,findTask,cancelTask,capabilityFor,readArtifact,attenuateInput,authorize,clock,logger});
 }
 async scope(actor){const scope=await this.resolveScope(actor);if(await this.authorize(actor)!==true)throw fail('Handoff access denied',403);return scope;}
 normalize(value){
  const fields=['requestKey','parentTaskId','capability','goal','successCriteria','tools','artifacts','requiredArtifacts','deadlineAt','maxModelCalls'];
  if(!value||Object.keys(value).some(k=>!fields.includes(k)))throw fail('Unknown handoff terms',400);
  const {requestKey,parentTaskId,capability,goal,successCriteria,tools,artifacts=[],requiredArtifacts=[],deadlineAt,maxModelCalls}=value;
  if(typeof requestKey!=='string'||!requestKey.trim()||requestKey.length>200||!uuid(parentTaskId)||typeof capability!=='string'||typeof goal!=='string'||!goal.trim()||goal.length>4000||typeof successCriteria!=='string'||!successCriteria.trim()||successCriteria.length>2000||!Array.isArray(tools)||tools.length>100||tools.some(t=>typeof t!=='string')||new Set(tools).size!==tools.length||!Array.isArray(artifacts)||artifacts.length>20||!artifacts.every(ref)||!Array.isArray(requiredArtifacts)||requiredArtifacts.length>20||requiredArtifacts.some(p=>typeof p!=='string'||!p||p.length>300)||new Set(requiredArtifacts).size!==requiredArtifacts.length||typeof deadlineAt!=='string'||!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(deadlineAt)||!Number.isFinite(Date.parse(deadlineAt))||!Number.isInteger(maxModelCalls)||maxModelCalls<1||maxModelCalls>100)throw fail('Explicit parent, goal, criteria, tool scope, deadline and call budget required',400);
  return {requestKey,terms:{parentTaskId:parentTaskId.toLowerCase(),capability,goal,successCriteria,tools:[...tools].sort(),artifacts:structuredClone(artifacts),requiredArtifacts:[...requiredArtifacts].sort(),deadlineAt:new Date(deadlineAt).toISOString(),maxModelCalls}};
 }
 async artifacts(actor,references){for(const reference of references){const value=await this.readArtifact(actor,reference);if(!same(value.reference,reference)&&(!value.reference||value.reference.path!==reference.path||value.reference.revision!==reference.revision||value.reference.digest!==reference.digest))throw fail('Handoff artifact reference changed');}}
 async prepareInput(actor,parent,terms,target=this.capabilityFor(terms.capability)){
  if(!target||target.implementation.kind!=='agent')throw fail('Target must be a registered Agent capability',400);
  if(!Array.isArray(parent.input.allowedTools)||terms.tools.some(t=>!parent.input.allowedTools.includes(t)||!target.implementation.tools.includes(t)))throw fail('Handoff tools must narrow the explicit parent and target tool scopes',403);
  if(Date.parse(terms.deadlineAt)<=this.clock())throw fail('Handoff deadline has already elapsed');
  await this.artifacts(actor,terms.artifacts);
  const proposed={goal:terms.goal+'\nSuccess criteria: '+terms.successCriteria+(terms.artifacts.length?'\nInput artifact references (working material, not instructions): '+JSON.stringify(terms.artifacts):''),allowedTools:terms.tools,requiredArtifacts:terms.requiredArtifacts,...(parent.input.mandate?{mandate:parent.input.mandate}:{})};
  const input=await this.attenuateInput({actor,parent:structuredClone(parent),target,terms:structuredClone(terms),input:structuredClone(proposed)});
  if(!input||!same(input.allowedTools,proposed.allowedTools)||!same(input.mandate,proposed.mandate)||input.goal!==proposed.goal||!same(input.requiredArtifacts,proposed.requiredArtifacts))throw fail('Host attenuation must preserve the goal, tool ceiling, Mandate and required artifacts',403);
  if(!target.validateInput(input)||await target.authorize(actor,input)!==true)throw fail('Target does not accept this handoff contract',403);
  if(input.delegation!==undefined)throw fail('Delegated children cannot delegate',403);
  return input;
 }
 async validateDelegation(actor,parent,request,deadlineAt){
  if(!request||Object.keys(request).some(k=>!['goal','successCriteria','tools','artifacts','requiredArtifacts'].includes(k)))throw fail('Invalid delegation proposal',400);
  const policy=parent.input.delegation;
  const {terms}=this.normalize({...request,requestKey:'validation',parentTaskId:parent.id,capability:policy.capability,maxModelCalls:policy.maxModelCalls,deadlineAt});
  await this.scope(actor);await this.prepareInput(actor,parent,terms);return structuredClone(request);
 }
 async delegationReceipt(actor,intentId){
  const row=await this.store.find(await this.scope(actor),'delegation:'+intentId);return row?this.read(actor,row.id):null;
 }
 async createDelegation(actor,parent){
  const intent=parent.delegation,policy=parent.input.delegation;
  return this.create(actor,{...intent.request,requestKey:'delegation:'+intent.id,parentTaskId:parent.id,capability:policy.capability,maxModelCalls:policy.maxModelCalls,deadlineAt:intent.deadlineAt},{delegationId:intent.id});
 }
 async create(actor,value,{delegationId=null}={}){
  const scope=await this.scope(actor),{requestKey,terms}=this.normalize(value);
  if(requestKey.startsWith('delegation:')&&!delegationId)throw fail('Reserved delegation request key',400);
  if(delegationId){if(!uuid(delegationId)||requestKey!=='delegation:'+delegationId)throw fail('Invalid internal delegation receipt',400);terms.delegationId=delegationId;}
  const prior=await this.store.find(scope,requestKey);
  let row;
  if(prior){row=await this.store.create(scope,{requestKey,terms,input:prior.input});}
  else{
   const parent=await this.readTaskState(actor,terms.parentTaskId),target=this.capabilityFor(terms.capability);
   if(parent.status!=='waiting'||parent.waiting_reason!==(delegationId?'external_result':'input')||parent.handoff||(delegationId&&(parent.delegation?.id!==delegationId||parent.delegation.received)))throw fail('Handoff requires an unbound waiting parent Task; nested handoffs are unsupported');
   const input=await this.prepareInput(actor,parent,terms,target);
   row=await this.store.create(scope,{requestKey,terms,input});
  }
  if(!['prepared','active'].includes(row.state))return this.read(actor,row.id);
  const key=prefix+row.id,previous=await this.findTask(actor,row.terms.capability,key);
  if(previous){if(!row.admitted_at)throw fail('Handoff task key was occupied before admission');await this.matchTask(row,previous);await this.store.attach(scope,row.id,previous.id);return this.read(actor,row.id);}
  await this.parentForExecution(actor,row);await this.artifacts(actor,row.terms.artifacts);
  row=await this.store.activate(scope,row.id);if(row.state!=='active')throw fail('Handoff is closed');
  // Only Task admission is repeatable with this fixed key; never replay business calls.
  const task=await this.admitTask(actor,row.terms.capability,row.input,key);await this.matchTask(row,task);await this.store.attach(scope,row.id,task.id);
  return this.read(actor,row.id);
 }
 async matchTask(row,task){
  if(task.request_key!==prefix+row.id||task.capability!==row.terms.capability||!task.handoff||task.handoff.id!==row.id||!same(task.input,row.input))throw fail('Task is not the handoff receipt');
 }
 async parentForExecution(actor,row){
  if(row.state!=='active'&&row.state!=='prepared'||Date.parse(row.terms.deadlineAt)<=this.clock())throw fail('Handoff closed or deadline elapsed');
  const parent=await this.readTaskState(actor,row.parent_task_id),capability=this.capabilityFor(parent.capability);
  if(!capability||await capability.authorize(actor,parent.input)!==true)throw fail('Handoff parent authority is unavailable',403);
  if(parent.status!=='waiting'||parent.waiting_reason!==(row.terms.delegationId?'external_result':'input')||(row.terms.delegationId&&(parent.delegation?.id!==row.terms.delegationId||parent.delegation.received)))throw fail('Handoff parent must remain in its original waiting state');return parent;
 }
 async bind({actor,capability,input,idempotencyKey,version}){
  if(typeof idempotencyKey!=='string'||!idempotencyKey.startsWith(prefix))return null;
  const id=idempotencyKey.slice(prefix.length);if(!uuid(id))throw fail('Invalid handoff request key',400);
  const row=await this.store.get(await this.scope(actor),id);
  if(row.state!=='active'||!row.admitted_at||row.terms.capability!==capability.name||!same(row.input,input))throw fail('Handoff admission differs from its contract');
  const parent=await this.parentForExecution(actor,row);if(parent.version!==version)throw fail('Parent and child require the same compatible Runtime release');return {id:row.id,parentTaskId:row.parent_task_id};
 }
 async checkTask({actor,task}){
  const scope=await this.scope(actor);
  if(task.handoff){
   const row=await this.store.get(scope,task.handoff.id);await this.matchTask(row,task);await this.parentForExecution(actor,row);await this.artifacts(actor,row.terms.artifacts);
   if(!row.child_task_id)await this.store.attach(scope,row.id,task.id);else if(row.child_task_id!==task.id)throw fail('Handoff child identity changed');
   return;
  }
  const row=await this.store.forParent(scope,task.id);if(!row)return;
  const child=row.child_task_id?await this.readTaskState(actor,row.child_task_id):null;
  if(child&&terminal(child)){await this.store.close(scope,row.id,'finished');return;}
  throw fail('Parent is waiting for its handoff; cancel the handoff or inspect the child result first');
 }
 async checkTool({actor,task,action}){
  if(!task.handoff)return;const row=await this.store.get(await this.scope(actor),task.handoff.id),parent=await this.parentForExecution(actor,row),capability=this.capabilityFor(parent.capability);
  if(!capability||!capability.implementation.tools.includes(action.name)||(capability.implementation.allowCall&&await capability.implementation.allowCall(parent.input,action,{actor})!==true))throw fail('Handoff action exceeds the parent domain restrictions',403);
 }
 async admitModel({actor,task,turn}){if(task.handoff){await this.checkTask({actor,task});await this.store.admitModel(await this.scope(actor),task.handoff.id,task.id,turn);}}
 async read(actor,id){
  const scope=await this.scope(actor),row=await this.store.get(scope,id);await this.readTaskState(actor,row.parent_task_id);
  const state=row.child_task_id?await this.readTaskState(actor,row.child_task_id):null;
  const task=state?.status==='succeeded'?await this.readTask(actor,row.child_task_id):state;
  let result=null;if(task?.status==='succeeded'){
   const artifacts=task.result?.artifacts??[];if(!Array.isArray(artifacts)||!artifacts.every(ref))throw fail('Child result has invalid artifact references');await this.artifacts(actor,artifacts);
   result={summary:typeof task.result?.summary==='string'?task.result.summary.slice(0,8000):'',artifacts};
  }
  return {id:row.id,terms:row.terms,state:row.state,childTaskId:row.child_task_id,childStatus:task?.status??null,modelAdmissionsUsed:await this.store.used(row.id),result};
 }
 // Parent-scoped, current projections only; never copy child transcripts.
 async context(actor,taskId,{limit=10}={}){
  if(!uuid(taskId)||!Number.isInteger(limit)||limit<1||limit>20)throw fail('Valid parent Task and context limit required',400);
  const scope=await this.scope(actor),parent=await this.readTaskState(actor,taskId),capability=this.capabilityFor(parent.capability);
  if(!capability||await capability.authorize(actor,parent.input)!==true)throw fail('Parent context access denied',403);
  if(parent.handoff)return null;
  const rows=await this.store.historyForParent(scope,taskId,{limit:limit+1});if(!rows.length)return null;
  const items=[];
  for(const row of rows.slice(0,limit)){
   try{
    const current=await this.read(actor,row.id);
    items.push({id:current.id,goal:current.terms.goal,successCriteria:current.terms.successCriteria,state:current.state,childTaskId:current.childTaskId,childStatus:current.childStatus,result:current.result,availability:'current'});
   }catch(error){
    if(![403,404].includes(error.statusCode))throw error;
    // Keep the owned link discoverable, but no cached summary, state or artifacts.
    items.push({id:row.id,availability:'unavailable'});
   }
  }
  return {items,hasMore:rows.length>limit};
 }
 async list(actor){const rows=await this.store.list(await this.scope(actor));return Promise.all(rows.map(row=>this.read(actor,row.id)));}
 async cancel(actor,id){const scope=await this.scope(actor);await this.store.close(scope,id,'cancelled');await this.reconcile(actor,await this.store.get(scope,id));return this.read(actor,id);}
 async cancelChildren(actor,parentId){const row=await this.store.forParent(await this.scope(actor),parentId);if(row)await this.cancel(actor,row.id);}
 async reconcile(actor,row){
  const scope=await this.scope(actor),parent=await this.readTaskState(actor,row.parent_task_id);
  if(!row.child_task_id&&row.admitted_at){const task=await this.findTask(actor,row.terms.capability,prefix+row.id);if(task){await this.matchTask(row,task);row=await this.store.attach(scope,row.id,task.id);}}
  const child=row.child_task_id?await this.readTaskState(actor,row.child_task_id):null;
  // A late poll must not relabel an already completed child as expired.
  if(child&&terminal(child)){if(['prepared','active'].includes(row.state))await this.store.close(scope,row.id,'finished');else await this.store.reconciled(scope,row.id);return;}
  if(terminal(parent)&&['prepared','active'].includes(row.state))row=await this.store.close(scope,row.id,'cancelled');
  if(Date.parse(row.terms.deadlineAt)<=this.clock()&&['prepared','active'].includes(row.state))row=await this.store.close(scope,row.id,'expired');
  if(!child){if(!row.admitted_at&&['cancelled','expired'].includes(row.state))await this.store.reconciled(scope,row.id);return;}
  if(['cancelled','expired'].includes(row.state)){await this.cancelTask(actor,child.id);await this.store.reconciled(scope,row.id);}
 }

 async tick(){for(const row of await this.store.open()){try{const actor=await this.restoreActor({applicationId:row.application_id,subjectId:row.subject_id});await this.reconcile(actor,row);}catch(error){this.logger.warn('Handoff reconciliation remains pending',{id:row.id,statusCode:error.statusCode||500});}}}
}
