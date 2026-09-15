import {timingSafeEqual} from 'node:crypto';
export const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export function key(value){if(typeof value!=='string'||!value.trim()||value.length>500)throw fail('Provider binding identifier required');return value;}
export function equalSecret(a,b){return typeof a==='string'&&typeof b==='string'&&a.length>0&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
export function rawBytes(raw){if(!Buffer.isBuffer(raw)||raw.length>1024*1024)throw fail('Raw webhook Buffer required (maximum 1 MiB)');return raw;}
export function boundRoute(route,provider,{direct=false}={}){
 if(route?.provider!==provider||!['direct','group'].includes(route.kind))throw fail('Provider route required');
 for(const field of ['installationId','conversationId','senderId'])key(route[field]);
 if(direct&&(route.kind!=='direct'||route.conversationId!==route.senderId||route.threadId))throw fail('Provider requires a direct sender route');
 return Object.freeze({...route});
}
export function deliveryInput({idempotencyKey,message},maxChars,maxBytes=Infinity){key(idempotencyKey);if(typeof message?.text!=='string'||!message.text.trim()||message.text.length>maxChars||Buffer.byteLength(message.text)>maxBytes)throw fail('Provider text length exceeded or empty');}
export async function postJson(url,body,{fetchImpl=fetch,signal,headers={}}={}){
 if(signal?.aborted)throw fail('Provider send cancelled');
 const response=await fetchImpl(url,{method:'POST',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000),headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
 if(!response.ok)throw fail('Provider response unavailable',502);
 return response.json();
}
export function deliveryPort({route,authorize,send,maxChars,maxBytes}){
 if(typeof authorize!=='function')throw fail('Current provider authorization required');
 return {allowed:true,send:async input=>{
  deliveryInput(input,maxChars,maxBytes);
  if(input.signal?.aborted||await authorize(route)!==true||input.signal?.aborted)return {status:'not_sent',idempotencyKey:input.idempotencyKey,reference:'local-preflight-denied'};
  try{return await send(input);}catch{return {status:'unknown',idempotencyKey:input.idempotencyKey,reason:'provider-response-unavailable'};}
 }};
}
