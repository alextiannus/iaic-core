import {importHttpCapabilities} from '../http/import.js';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
// This binds a host-approved provider API; recipient and credential resolution remain host code.
export function createHttpNotificationChannel({baseUrl,resolveHeaders,bindings,idempotencyHeader,fetch,timeoutMs=30000}){
 if(typeof bindings?.send?.request!=='function'||typeof bindings.send.project!=='function'||bindings.query!==undefined&&(typeof bindings.query?.request!=='function'||typeof bindings.query.project!=='function')||typeof idempotencyHeader!=='string'||!idempotencyHeader)throw fail('Notification HTTP adapter requires send mapping, receipt projection and an idempotency header contract');
 const operations=bindings.query?['send','query']:['send'];
 const mappings=Object.fromEntries(operations.map(operation=>[operation,{request:bindings[operation].request,project:bindings[operation].project}]));
 const capabilities=importHttpCapabilities({baseUrl,resolveHeaders,fetch,timeoutMs,bindings:operations.map(operation=>({name:'notification-channel.'+operation,description:'Host-bound notification '+operation,input:{type:'object'},output:{type:'object'},authorize:()=>true,effect:operation==='send'?'write':'read',method:operation==='send'?'POST':'GET',...(operation==='send'?{retry:'never-replay',idempotencyHeader}:{}),request:mappings[operation].request,
  project:async(body,context)=>{
   const receipt=await mappings[operation].project(body,context);
   if(!receipt||!['delivered','not_sent','unknown'].includes(receipt.status)||receipt.idempotencyKey!==context.input.idempotencyKey)throw fail('Notification receipt does not match the original request',502);
   if(receipt.status!=='unknown'&&(typeof receipt.reference!=='string'||!receipt.reference.trim()||receipt.reference.length>500))throw fail('Terminal notification receipt requires a provider evidence reference',502);
   return receipt;
  }
 }))});
 return Object.fromEntries(capabilities.map((cap,index)=>[operations[index],async input=>{
  if(typeof input?.idempotencyKey!=='string'||!input.idempotencyKey||input.idempotencyKey.length>500)throw fail('Stable notification idempotency key required');
  const {signal,...operation}=input;
  return cap.implementation.execute(operation,{signal,callId:input.idempotencyKey});
 }]));
}
