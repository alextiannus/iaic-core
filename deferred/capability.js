import {deferredControlTools} from './tools.js';
import {isDeepStrictEqual} from 'node:util';
import {defineCapability} from '../capabilities/index.js';
const fail=message=>Object.assign(new Error(message),{statusCode:409});
const key=callId=>{if(typeof callId!=='string'||!callId)throw fail('Scheduling requires a stable call ID');return 'agent-call:'+callId;};
const matches=(receipt,input)=>receipt&&new Date(receipt.dueAt).toISOString()===new Date(input.dueAt).toISOString()&&isDeepStrictEqual(receipt.input,input.task)&&receipt.trigger===null;
// The host validates future input again at admission. This only exposes the
// existing durable scheduler as an ordinary, receipt-backed write capability.
export function createDeferredScheduleCapability({name='assistant.schedule',deferred,taskSchema,authorize}){
 return defineCapability({name,description:'Schedule a one-time future goal at an explicit timestamp. A receipt confirms scheduling only, not completion. The future Task uses current model and allowance settings. Do not schedule additional schedules.',input:{type:'object',properties:{dueAt:{type:'string',minLength:20,maxLength:40},task:taskSchema},required:['dueAt','task'],additionalProperties:false},output:{type:'object'},effect:'write',retry:'idempotent',authorize,preflight:input=>/(Z|[+-]\d\d:\d\d)$/.test(input.dueAt)&&Number.isFinite(Date.parse(input.dueAt)),
  implementation:{kind:'function',execute:(input,{actor,callId})=>deferred.schedule(actor,{requestKey:key(callId),dueAt:input.dueAt,input:input.task},{internal:true})},
  revalidate:async(input,result,{actor})=>{const current=await deferred.get(actor,result.id);if(!matches(current,input))throw fail('Scheduled receipt does not match this call');return current;},
  reconcile:async(input,{actor,callId})=>{const receipt=await deferred.findRequest(actor,key(callId));if(!receipt)return {confirmed:false};if(!matches(receipt,input))throw fail('Scheduled request key belongs to different input');return {confirmed:true,result:receipt};}
 });
}
// Called against trusted parent input before execution, never from Skill text.
export function allowsScheduledTask(parent,child,tools){
 if(!child||!Array.isArray(child.allowedTools)||!child.allowedTools.every(tool=>tools.includes(tool)))return false;
 for(const field of ['session','sourceEventKey','sourceTaskId','mandate'])if(parent[field]!==undefined&&!isDeepStrictEqual(parent[field],child[field]))return false;
 return child.delegation===undefined;
}

export function createDeferredControlCapabilities({deferred,authorize}){
 return deferredControlTools(deferred,null).map(descriptor=>{
  const name=descriptor.name,writing=name.includes('_cancel_')||name.includes('_retry_');
  const execute=(input,{actor})=>deferredControlTools(deferred,actor).find(tool=>tool.name===name).handler(input);
  return defineCapability({name,description:descriptor.description,input:descriptor.inputSchema,output:{type:'object'},effect:writing?'write':'read',...(writing?{retry:'never-replay'}:{}),authorize,
   implementation:{kind:'function',execute},revalidate:writing?(input,_result,{actor})=>deferred.get(actor,input.id):(input,_result,context)=>execute(input,context),
   ...(name==='my_cancel_scheduled_assistant_task'?{reconcile:async(input,{actor})=>{const receipt=await deferred.get(actor,input.id);return receipt.state==='cancelled'?{confirmed:true,result:receipt}:{confirmed:false};}}:{})});
 });
}
