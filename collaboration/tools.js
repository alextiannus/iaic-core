import {defineCapability} from '../capabilities/index.js';

// The external participant retains its own runtime. All authority and original
// effect admission stay in DelegatedCapabilities, not in this protocol adapter.
export function createDelegatedToolCapabilities({grants,prefix='collaboration.tools'}){
 if(['invoke','read','revoke'].some(name=>typeof grants?.[name]!=='function'))throw new Error('Delegated capability service required');
 const key={type:'string',minLength:1,maxLength:200};
 const receipt=async(actor,input)=>{
  const grant=await grants.read(actor,input.grantId);
  const call=grant.calls.find(row=>row.call_id===input.callId);
  return {grantId:grant.id,callId:input.callId,receipt:call??null,unknown:!call||call.outcome!=='returned'};
 };
 const read=async(input,{actor})=>{
  const grant=await grants.read(actor,input.grantId);
  // Preserve the original operation keys without copying result bodies or prompts.
  return {grantId:grant.id,revoked:grant.revoked,issuer:grant.terms.issuer,delegate:grant.terms.delegate,payer:grant.terms.payer,deadlineAt:grant.terms.deadlineAt,maxCalls:grant.terms.maxCalls,tools:grant.terms.tools,calls:grant.calls};
 };
 return [
  defineCapability({name:prefix+'.invoke',description:'Invoke one tool under an existing function grant as yourself. Keep grantId and callId; after an uncertain result inspect the original receipt and domain effect. Never replay an admitted attempt.',input:{type:'object',properties:{grantId:key,callId:key,capability:key,input:{type:'object'}},required:['grantId','callId','capability','input'],additionalProperties:false},output:{type:'object'},effect:'write',retry:'never-replay',authorize:async()=>true,revalidate:(input,_result,{actor})=>receipt(actor,input),implementation:{kind:'function',execute:(input,{actor,signal})=>grants.invoke(actor,input,{signal})}}),
  defineCapability({name:prefix+'.read',description:'Read currently authorized grant metadata and original operation receipts. A missing, admitted or unknown receipt does not prove that no effect occurred. Query its original effect key through an authorized domain capability before covering unfinished work.',input:{type:'object',properties:{grantId:key},required:['grantId'],additionalProperties:false},output:{type:'object'},effect:'read',authorize:async()=>true,revalidate:(input,_result,context)=>read(input,context),implementation:{kind:'function',execute:read}}),
  defineCapability({name:prefix+'.revoke',description:'As issuer, stop later function-grant admissions. This does not cancel in-flight effects or prove their absence. Task-bound grants require the existing delegated Task cancellation service.',input:{type:'object',properties:{grantId:key},required:['grantId'],additionalProperties:false},output:{type:'object'},effect:'write',retry:'idempotent',authorize:async()=>true,revalidate:(input,_result,context)=>read(input,context),implementation:{kind:'function',execute:async(input,{actor})=>{
   const grant=await grants.read(actor,input.grantId);
   if(grant.terms.task)throw Object.assign(new Error('Use delegated Task cancellation for a Task-bound grant'),{statusCode:403});
   await grants.revoke(actor,input.grantId);return read(input,{actor});
  }}})
 ];
}
