import {isDeepStrictEqual} from 'node:util';
import {AssistantSessions,startSessionTask} from '../sessions/service.js';
import {DeferredTasks} from '../deferred/service.js';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});

// Compose current Task/Artifact views into a Session without copying their data
// or depending on application tables. The host read ports enforce current access.
export function createAgentSessions({store,resolveScope,readTask,readArtifact,...options}){
 return new AssistantSessions({...options,store,resolveScope,taskView:async(actor,{sessionId,taskId})=>{
  const task=await readTask(actor,taskId);
  if(task.input.session?.id?.toLowerCase()!==sessionId.toLowerCase())throw fail('Session task not found',404);
  const artifacts=[];
  for(const reference of task.result?.artifacts??[]){try{await readArtifact(actor,reference);artifacts.push(reference);}catch(error){if(![403,404,409].includes(error.statusCode))throw error;}}
  return {taskId:task.id,status:task.status,goal:task.input.goal,artifacts};
 }});
}

// Use the ordinary Agent capability for future work and repair its Session
// association on receipt recovery. This adds no scheduler, tables or Runtime.
export function createAgentDeferredTasks({name='assistant.run',store,resolveScope,restoreActor,dispatcher,sessions=null,taskStore,startTask=null,isEnabled,triggers=null,validateTask=null,reservedPrefixes=['agent-call:'],logger=console}){
 return new DeferredTasks({store,resolveScope,restoreActor,isEnabled,triggers,reservedPrefixes,logger,
  validateInput:async(actor,input,trigger)=>{
   const capability=dispatcher.capabilities.get(name);
   if(!capability||capability.implementation.kind!=='agent')throw fail('Scheduled Agent capability is unavailable',404);
   if(!capability.validateInput(input)||!Array.isArray(input.allowedTools)||input.allowedTools.length===0)throw fail('Scheduled goals require a valid task input and explicit allowedTools');
   if(validateTask)await validateTask(actor,input,trigger);
   if(await capability.authorize(actor,input)!==true)throw fail('Scheduled task access denied',403);
  },
  findTask:async(actor,key,input)=>{
   const task=await taskStore.findRequest(actor,name,key);if(!task)return null;
   if(!isDeepStrictEqual(task.input,input))throw fail('Scheduled task key belongs to different input',409);
   // The durable receipt still proves admission when Session access was revoked.
   // Such association repair remains pending; do not start the work again.
   if(input.session&&sessions){try{await sessions.linkTask(actor,{sessionId:input.session.id,taskId:task.id});}catch(error){if(![401,403,404,409].includes(error.statusCode))throw error;}}
   return task;
  },
  startTask:startTask||((actor,input,key)=>startSessionTask({sessions,actor,input,startTask:()=>dispatcher.invoke(name,input,{actor,callId:key})}))
 });
}
