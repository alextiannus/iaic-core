import {isDeepStrictEqual} from 'node:util';
import {DeferredTasks} from '../deferred/service.js';
import {RecurringTasks} from './service.js';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});

// Compose existing scheduling services with the shared dispatcher, without a new task store.
export function createAgentTaskSchedules({deferredStore,recurringStore,dispatcher,tasks,resolveScope,restoreActor,authorize,isEnabled=()=>true,logger=console}){
 if(!deferredStore||!recurringStore||typeof dispatcher?.invoke!=='function'||typeof tasks?.findRequest!=='function'||typeof resolveScope!=='function'||typeof restoreActor!=='function'||typeof authorize!=='function')throw fail('Agent schedules require stores, shared dispatch, receipt lookup and trusted scope/authorization ports');
 const validateInput=async(actor,envelope,trigger=null)=>{
  if(trigger!==null)throw fail('This composition accepts timed Agent tasks only');
  if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||Object.keys(envelope).some(k=>!['capability','input'].includes(k))||typeof envelope.capability!=='string'||!envelope.input||typeof envelope.input!=='object'||Array.isArray(envelope.input))throw fail('Scheduled Agent capability and object input required');
  const capability=dispatcher.capabilities.get(envelope.capability);
  if(!capability||capability.implementation.kind!=='agent')throw fail('Scheduled capability must be a registered Agent',404);
  if(dispatcher.validateActor(actor,capability)!==true)throw fail('Current Agent identity required',401);
  if(!capability.validateInput(envelope.input))throw fail('Scheduled Agent input is invalid');
  if(await authorize(actor,{capability:envelope.capability,input:envelope.input})!==true||await capability.authorize(actor,envelope.input)!==true)throw fail('Scheduled Agent access denied',403);
 };
 const deferred=new DeferredTasks({store:deferredStore,resolveScope,restoreActor,validateInput,isEnabled,logger,reservedPrefixes:['recurring:'],
  startTask:async(actor,envelope,key)=>{await validateInput(actor,envelope);return dispatcher.invoke(envelope.capability,envelope.input,{actor,callId:key});},
  findTask:async(actor,key,envelope)=>{
   await validateInput(actor,envelope);
   const task=await tasks.findRequest(actor,envelope.capability,key);
   if(task&&(!isDeepStrictEqual(task.input,envelope.input)||task.capability!==envelope.capability))throw fail('Scheduled Task receipt belongs to different input',409);
   return task;
  }
 });
 const recurring=new RecurringTasks({store:recurringStore,resolveScope,restoreActor,validateInput,isEnabled,logger,scheduleOccurrence:(actor,request)=>deferred.schedule(actor,request,{internal:true})});
 return {deferred,recurring};
}
