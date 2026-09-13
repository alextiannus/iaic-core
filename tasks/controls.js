import {defineCapability} from '../capabilities/index.js';
const id={type:'string',pattern:'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'};
const publicView=(task,{operation})=>({id:task.id,capability:task.capability,status:task.status,waitingReason:task.waiting_reason??null,...(operation==='get'?{result:task.result??null,inputRequest:task.inputRequest??null}:{}),...(task.controlReceipt?{controlReceipt:task.controlReceipt}:{})});

// All state transitions remain owned by the same Runtime and Task store.
export function createTaskControlCapabilities({runtime,authorize,namespace='tasks',project=publicView,receipts=false}){
 if(['get','state','transition'].some(method=>typeof runtime?.[method]!=='function')||typeof authorize!=='function'||typeof project!=='function')throw new Error('Task controls require Runtime get/state/transition, authorization and projection ports');
 if(typeof namespace!=='string'||!namespace||!/^[a-z][a-z0-9_.-]*$/.test(namespace))throw new Error('Invalid task control namespace');
 if(receipts&&typeof runtime.transitionReceipt!=='function')throw new Error('Reliable task controls require the Runtime transitionReceipt port');
 const capabilities=['get','state','cancel','resume','provide_input'].map(operation=>{
  const reading=['get','state'].includes(operation),recorded=receipts&&['resume','provide_input'].includes(operation);
  const input={type:'object',properties:{id,...(operation==='provide_input'?{input:{type:'string',minLength:1,maxLength:8000}}:{})},required:operation==='provide_input'?['id','input']:['id'],additionalProperties:false};
  const view=(row,context,kind)=>project(row,{actor:context.actor,operation:kind});
  const execute=async(request,context)=>{
   const row=reading?await runtime[operation](context.actor,request.id):await runtime.transition(context.actor,request.id,{action:operation,...(operation==='provide_input'?{input:request.input}:{}),...(recorded?{requestKey:context.callId}:{})});
   return view(row,context,operation);
  };
  return defineCapability({name:namespace+'.'+operation,description:({get:'Read currently authorized Task result',state:'Read Task lifecycle state without historical source content',cancel:'Cancel a Task and propagate cancellation through the Runtime',resume:'Resume an eligible waiting Task using its original execution binding',provide_input:'Supply a clarification to a Task waiting for input'})[operation],input,output:{type:'object'},effect:reading?'read':'write',...(!reading?{retry:operation==='cancel'||recorded?'idempotent':'never-replay'}:{}),authorize,
   // History refresh never repeats a transition or a user clarification.
   revalidate:async(request,_result,context)=>{
    if(reading)return execute(request,context);
    if(recorded){const receipt=await runtime.transitionReceipt(context.actor,request.id,context.callId);if(receipt.status!=='confirmed')throw Object.assign(new Error('Original transition remains unknown'),{statusCode:409});return view(receipt.task,context,operation);}
    return view(await runtime.state(context.actor,request.id),context,'state');
   },
   implementation:{kind:'function',execute}});
 });
 if(receipts){
  const execute=({id,requestKey},{actor})=>runtime.transitionReceipt(actor,id,requestKey);
  capabilities.push(defineCapability({name:namespace+'.control_result',description:'Read the original resume or clarification receipt; missing evidence remains unknown',input:{type:'object',properties:{id,requestKey:{type:'string',minLength:1,maxLength:500}},required:['id','requestKey'],additionalProperties:false},output:{type:'object'},effect:'read',authorize,revalidate:(input,_result,context)=>execute(input,context),implementation:{kind:'function',execute}}));
 }
 return capabilities;
}
