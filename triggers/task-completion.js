const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const taskTriggerSchema={type:'object',properties:{kind:{const:'task'},taskId:{type:'string',pattern:'^[0-9a-fA-F-]{36}$'},on:{type:'string',enum:['succeeded','finished']}},required:['kind','taskId','on'],additionalProperties:false};
// Observe authoritative durable terminal state through a public host port.
// No new broker, Task table ownership or model execution lives here.
export class TaskCompletionTriggers {
 constructor({readTask}){this.readTask=readTask;}
 reference(trigger){
  if(!trigger||trigger.kind!=='task'||!uuid(trigger.taskId)||!['succeeded','finished'].includes(trigger.on)||Object.keys(trigger).some(k=>!['kind','taskId','on'].includes(k)))throw fail('Explicit source Task and completion condition required');
  const value={kind:'task',taskId:trigger.taskId.toLowerCase(),on:trigger.on};
  return value;
 }
 async source(actor,trigger){
  const value=this.reference(trigger),task=await this.readTask(actor,value.taskId);
  if(typeof task.id!=='string'||task.id.toLowerCase()!==value.taskId||!['queued','running','waiting','succeeded','failed','cancelled'].includes(task.status))throw fail('Source Task identity or state is invalid',409);
  return {value,task};
 }
 async normalize(actor,trigger){return (await this.source(actor,trigger)).value;
 }
 async check(actor,trigger){
  const {value,task}=await this.source(actor,trigger);
  if(!['succeeded','failed','cancelled'].includes(task.status))return null;
  if(value.on==='succeeded'&&task.status!=='succeeded')throw fail('Source Task ended without success; this condition cannot fire',409);
  if(!Number.isFinite(Date.parse(task.updatedAt)))throw fail('Source Task completion timestamp unavailable',409);
  return {kind:'task',taskId:value.taskId,status:task.status,completedAt:new Date(task.updatedAt).toISOString()};
 }
 async followUp(deferred,actor,{requestKey,trigger,input}){
  const normalized=await this.normalize(actor,trigger);
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Task input required');
  if(input.sourceTaskId!==undefined&&(!uuid(input.sourceTaskId)||input.sourceTaskId.toLowerCase()!==normalized.taskId))throw fail('Goal source Task differs from trigger',409);
  return deferred.schedule(actor,{requestKey,dueAt:'1970-01-01T00:00:00.000Z',trigger:normalized,input:{...input,sourceTaskId:normalized.taskId}});
 }
}
export function taskFollowupTool(triggers,deferred,actor,taskSchema){
 return {name:'my_follow_up_assistant_task',description:'Save a one-time goal to run after an existing Task succeeds or finishes. Its sourceTaskId is pinned. Supply explicit allowedTools; no inference occurs until the condition is met. Uses the existing scheduled-task query/cancel/retry lifecycle.',inputSchema:{type:'object',properties:{requestKey:{type:'string',minLength:1,maxLength:200},trigger:taskTriggerSchema,input:{...taskSchema,required:[...new Set([...taskSchema.required,'allowedTools'])]}},required:['requestKey','trigger','input'],additionalProperties:false},handler:input=>triggers.followUp(deferred,actor,input)};
}
