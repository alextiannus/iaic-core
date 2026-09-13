import {createHmac,timingSafeEqual} from 'node:crypto';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const part=(value,max)=>typeof value==='string'&&value.length>=1&&value.length<=max&&/^[A-Za-z0-9._-]+$/.test(value);
export const WEBHOOK_EVENT_PREFIX='iaic-webhook:';

// IAiC's documented HMAC envelope, not an adapter for a vendor-specific signature protocol.
export function eventSigningBytes({endpointId,keyId,deliveryId,timestamp,body}){
 if(!part(endpointId,32)||!part(keyId,64)||!part(deliveryId,128)||typeof timestamp!=='string'||!/^[1-9][0-9]{0,15}$/.test(timestamp)||!Number.isSafeInteger(Number(timestamp))||!Buffer.isBuffer(body))throw fail('Valid signed event envelope required');
 return Buffer.concat([Buffer.from(`iaic-event-v1\n${endpointId}\n${keyId}\n${deliveryId}\n${timestamp}\n`,'utf8'),body]);
}
export class HmacEventIngress{
 constructor({store,resolveEndpoint,now=()=>Date.now(),maxAgeMs=300000,maxFutureMs=30000,maxBodyBytes=8000}){
  if(typeof store?.publish!=='function'||typeof resolveEndpoint!=='function'||!Number.isInteger(maxAgeMs)||maxAgeMs<1||maxAgeMs>86400000||!Number.isInteger(maxFutureMs)||maxFutureMs<0||maxFutureMs>300000||!Number.isInteger(maxBodyBytes)||maxBodyBytes<1||maxBodyBytes>8000)throw fail('Trusted ingress ports and bounded freshness/body limits required');
  Object.assign(this,{store,resolveEndpoint,now,maxAgeMs,maxFutureMs,maxBodyBytes});
 }
 async accept(input){
  if(!Buffer.isBuffer(input?.body)||input.body.length>this.maxBodyBytes)throw fail('Webhook body exceeds limit or is not raw bytes',413);
  // Snapshot caller-owned bytes before any asynchronous credential resolution.
  const envelope={endpointId:input.endpointId,keyId:input.keyId,deliveryId:input.deliveryId,timestamp:input.timestamp,body:Buffer.from(input.body)},signed=eventSigningBytes(envelope),signature=input.signature;
  if(typeof signature!=='string'||!/^sha256=[a-f0-9]{64}$/.test(signature))throw fail('Webhook signature required',401);
  const binding=await this.resolveEndpoint({endpointId:envelope.endpointId,keyId:envelope.keyId});
  if(!binding||binding.enabled!==true||!Buffer.isBuffer(binding.secret)||binding.secret.length<32||!binding.scope)throw fail('Webhook endpoint or signing key unavailable',401);
  const expected=createHmac('sha256',binding.secret).update(signed).digest();
  if(!timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex')))throw fail('Webhook signature invalid',401);
  const age=Number(this.now())-Number(envelope.timestamp);
  if(!Number.isFinite(age)||age>this.maxAgeMs||age < -this.maxFutureMs)throw fail('Webhook timestamp is outside the accepted window',401);
  let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(envelope.body));}catch{throw fail('Webhook body must be UTF-8 JSON');}
  if(!data||typeof data!=='object'||Array.isArray(data))throw fail('Webhook data must be a JSON object');
  const source={kind:'signed-webhook',endpointId:envelope.endpointId,keyId:envelope.keyId,signedAt:envelope.timestamp};
  const event=await this.store.publish(binding.scope,{key:WEBHOOK_EVENT_PREFIX+envelope.endpointId+':'+envelope.deliveryId,data,source});
  if(event.source?.kind!==source.kind||event.source?.endpointId!==source.endpointId)throw fail('Webhook key was occupied by another source',409);
  return event;
 }
}

export function createHmacEventHandler({ingress,endpointId}){
 if(typeof ingress?.accept!=='function'||!Number.isInteger(ingress.maxBodyBytes)||ingress.maxBodyBytes<1||ingress.maxBodyBytes>8000||!part(endpointId,32))throw fail('Ingress and fixed endpoint ID required');
 return async(req,res)=>{
  const send=(status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(body));};
  if(req.method!=='POST'){res.setHeader('allow','POST');return send(405,{error:'POST required'});}
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')||req.headers['content-encoding'])return send(415,{error:'Uncompressed JSON required'});
  try{
   const headers=['x-iaic-key-id','x-iaic-delivery-id','x-iaic-timestamp','x-iaic-signature'];
   for(const name of headers){const occurrences=(req.rawHeaders||[]).filter((_,index)=>index%2===0).filter(key=>key.toLowerCase()===name).length;if(occurrences>1)throw fail('Duplicate signature headers');}
   const chunks=[];let length=0;
   for await(const chunk of req.iterator({destroyOnReturn:false})){length+=chunk.length;if(length>ingress.maxBodyBytes){send(413,{error:'Webhook body exceeds limit'});req.resume();return;}chunks.push(chunk);}
   const receipt=await ingress.accept({endpointId,keyId:req.headers['x-iaic-key-id'],deliveryId:req.headers['x-iaic-delivery-id'],timestamp:req.headers['x-iaic-timestamp'],signature:req.headers['x-iaic-signature'],body:Buffer.concat(chunks)});
   return send(200,{id:receipt.id,key:receipt.key,digest:receipt.digest,publishedAt:receipt.publishedAt});
  }catch(error){return send([400,401,403,409,413].includes(error.statusCode)?error.statusCode:500,{error:error.statusCode&&error.statusCode<500?error.message:'Webhook ingestion failed'});}
 };
}
