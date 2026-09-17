// A trusted Host supplies current declaration and probe evidence. This module
// checks their binding; it neither performs probes nor turns model text into proof.
const codes=new Set(['MODEL_CAPABILITY_MISMATCH','MODEL_VERIFICATION_REQUIRED','MODEL_VERIFICATION_EXPIRED','MODEL_VERIFICATION_STALE','MODEL_TRANSPORT_INSECURE','MODEL_READINESS_REVOKED','MODEL_READINESS_UNAVAILABLE']);
const failure=(code,statusCode=503)=>Object.assign(new Error(code),{code,publicCode:code,statusCode,providerNotCalled:true});
export const isModelReadinessError=error=>codes.has(error?.code)&&error?.providerNotCalled===true;
const text=(value,max=256)=>typeof value==='string'&&value.length>0&&value.length<=max&&value.trim()===value;
const capabilities=value=>Array.isArray(value)&&value.length<=64&&value.every(v=>typeof v==='string'&&/^[a-z][a-z0-9_.-]{0,63}$/.test(v))&&new Set(value).size===value.length;
function binding(value){
 if(!value||!text(value.modelIdentity,512)||!text(value.credentialRevision)||!text(value.certificateIdentity,512)||!text(value.endpoint,2048))throw failure('MODEL_VERIFICATION_REQUIRED');
 let url;try{url=new URL(value.endpoint);}catch{throw failure('MODEL_TRANSPORT_INSECURE');}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw failure('MODEL_TRANSPORT_INSECURE');
 return {modelIdentity:value.modelIdentity,endpoint:url.href,origin:url.origin,credentialRevision:value.credentialRevision,certificateIdentity:value.certificateIdentity};
}
export function withModelReadiness({model,binding:expectedBinding,requirements,resolve,now=Date.now}){
 if(!model||!text(model.name,512)||typeof model.next!=='function'||!capabilities(requirements)||typeof resolve!=='function'||typeof now!=='function')throw new Error('Model readiness requires a model, capability requirements and trusted resolver');
 const expected=binding(expectedBinding);
 if(expected.modelIdentity!==model.name)throw failure('MODEL_VERIFICATION_STALE');
 const required=Object.freeze([...requirements]);
 const checkReady=async({signal}={})=>{
  signal?.throwIfAborted();
  let snapshot;try{snapshot=await resolve({modelIdentity:model.name,signal});}catch{signal?.throwIfAborted();throw failure('MODEL_READINESS_UNAVAILABLE');}
  signal?.throwIfAborted();
  // Do not include resolver errors, endpoints or credentials in public failures.
  if(snapshot?.active!==true)throw failure('MODEL_READINESS_REVOKED',403);
  const current=binding(snapshot.binding),proof=snapshot.verification;
  if(Object.keys(expected).some(key=>expected[key]!==current[key]))throw failure('MODEL_VERIFICATION_STALE');
  if(!proof||!capabilities(snapshot.declaredCapabilities)||!capabilities(proof.capabilities))throw failure('MODEL_VERIFICATION_REQUIRED');
  const verified=binding(proof.binding);
  if(Object.keys(current).some(key=>current[key]!==verified[key]))throw failure('MODEL_VERIFICATION_STALE');
  if(proof.tlsVerified!==true)throw failure('MODEL_TRANSPORT_INSECURE');
  const time=now();
  if(!Number.isSafeInteger(time)||!Number.isSafeInteger(proof.verifiedAt)||!Number.isSafeInteger(proof.expiresAt)||proof.verifiedAt>time||proof.expiresAt<=proof.verifiedAt)throw failure('MODEL_VERIFICATION_REQUIRED');
  if(proof.expiresAt<=time)throw failure('MODEL_VERIFICATION_EXPIRED');
  if(required.some(cap=>!snapshot.declaredCapabilities.includes(cap)||!proof.capabilities.includes(cap)))throw failure('MODEL_CAPABILITY_MISMATCH',422);
  return Object.freeze({...current,capabilities:required,verifiedAt:proof.verifiedAt,expiresAt:proof.expiresAt});
 };
 return Object.freeze({name:model.name,...(model.model===undefined?{}:{model:model.model}),...(model.profileId===undefined?{}:{profileId:model.profileId}),...(model.metered===undefined?{}:{metered:model.metered}),checkReady,async next(request){await checkReady({signal:request.signal});return model.next(request);}});
}
