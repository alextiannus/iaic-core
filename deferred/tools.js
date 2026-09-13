export function deferredTools(deferred,actor,taskSchema){
 return [
  {name:'my_schedule_assistant_task',description:'Persist a one-time future Assistant goal. Supply an explicit timestamp and allowedTools; no model call happens during scheduling. Execution uses current permissions, model settings and allowance rules.',inputSchema:{type:'object',properties:{requestKey:{type:'string',minLength:1,maxLength:200},dueAt:{type:'string',minLength:20,maxLength:40},input:{...taskSchema,required:[...new Set([...taskSchema.required,'allowedTools'])]}},required:['requestKey','dueAt','input'],additionalProperties:false},handler:input=>deferred.schedule(actor,input)},
  ...deferredControlTools(deferred,actor)
 ];
}

export function deferredControlTools(deferred,actor){
 const id={type:'string',pattern:'^[0-9a-fA-F-]{36}$'};
 return [
  {name:'my_get_scheduled_assistant_task',description:'Read a scheduled intent and its Task reference. Dispatched means the Task exists, not that its goal is complete.',inputSchema:{type:'object',properties:{id},required:['id'],additionalProperties:false},handler:input=>deferred.get(actor,input.id)},
  {name:'my_list_scheduled_assistant_tasks',description:'List this Assistant scheduled goals.',inputSchema:{type:'object',properties:{after:id,limit:{type:'integer',minimum:1,maximum:50}},additionalProperties:false},handler:input=>deferred.list(actor,input)},
  ...['cancel','retry'].map(action=>({name:'my_'+action+'_scheduled_assistant_task',description:action==='cancel'?'Cancel before dispatch admission. After admission, use the linked Task cancellation API.':'Retry a blocked dispatch with the identical stored goal and task key.',inputSchema:{type:'object',properties:{id},required:['id'],additionalProperties:false},handler:input=>deferred[action](actor,input.id)}))
 ];
}
