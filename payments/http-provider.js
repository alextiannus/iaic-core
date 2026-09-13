import {importHttpCapabilities} from '../http/import.js';

// Bind an existing payment API explicitly; no provider-specific URLs or secrets are inferred.
export function createHttpPaymentProvider({baseUrl,resolveHeaders,bindings,idempotencyHeader,fetch,timeoutMs=30000}){
 if(!bindings||['charge','refund','query'].some(k=>typeof bindings[k]?.request!=='function'||typeof bindings[k]?.project!=='function')||typeof idempotencyHeader!=='string'||!idempotencyHeader)throw new Error('Payment HTTP adapter requires charge/refund/query mappings and the provider idempotency header');
 const caps=importHttpCapabilities({baseUrl,resolveHeaders,fetch,timeoutMs,bindings:['charge','refund','query'].map(operation=>({
  name:'payment-provider.'+operation,description:'Host-bound payment provider '+operation,input:{type:'object'},output:{type:'object'},authorize:()=>true,
  effect:operation==='query'?'read':'write',method:operation==='query'?'GET':'POST',...(operation==='query'?{}:{retry:'never-replay',idempotencyHeader}),
  request:bindings[operation].request,project:bindings[operation].project
 }))});
 return Object.fromEntries(caps.map((cap,index)=>[['charge','refund','query'][index],(operation,{actor,signal}={})=>cap.implementation.execute(operation,{actor,signal,callId:operation.id})]));
}
