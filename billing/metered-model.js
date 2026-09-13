import {randomUUID} from 'node:crypto';
const pending=()=>Object.assign(new Error('Model usage requires reconciliation before continuing'),{code:'USAGE_RECONCILIATION_REQUIRED',statusCode:409});

// One gateway wrapper per resolved account/model. Account, credential mode and
// platform allowance rates come from trusted configuration, never model output.
export function meteredModel({model,ledger,scope,policy,mode='SYSTEM_MANAGED'}){
 if(!policy?.price||policy.maximum===undefined)throw new Error('Platform allowance policy required');
 return Object.freeze({name:model.name,model:model.model,profileId:model.profileId,async next(request){
  const context=request.billingContext;
  if(!context?.taskId||!Number.isInteger(context.turn))throw new Error('Trusted runtime billing context required');
  request.signal?.throwIfAborted();
  if(await ledger.hasPendingTask(scope,context.taskId))throw pending();
  const requestId=randomUUID();
  await ledger.reserve(scope,{requestId,mode,maximum:mode==='BYOK'?0:policy.maximum,price:policy.price,
   attribution:{...context,model:model.name,profile:model.profileId??null}});
  // A crash after reservation leaves a durable hold; never assume zero usage.
  if(request.signal?.aborted){
   await ledger.release(scope,{requestId,evidence:{providerAccepted:false,reference:'cancelled-before-dispatch'}});
   request.signal.throwIfAborted();
  }
  let response,providerError;
  try{response=await model.next(request);}catch(error){providerError=error;}
  if(providerError?.providerNotCalled){await ledger.release(scope,{requestId,evidence:{providerAccepted:false,reference:'credential-preflight'}});throw providerError;}
  const observed=providerError||response;
  const usage=observed?.usage;
  const integer=value=>Number.isSafeInteger(value)&&value>=0;
  if(!integer(usage?.inputTokens)||!integer(usage?.outputTokens)){
   await ledger.markUnknown(scope,{requestId,evidence:{reason:'usage_unavailable'}});
   throw pending();
  }
  const rawUsage=observed?.usageEvidence?.rawUsage??null;
  const normalized={input_tokens:usage.inputTokens,output_tokens:usage.outputTokens,
   ...(integer(usage.cachedInputTokens)?{input_tokens_details:{cached_tokens:usage.cachedInputTokens}}:{}),
   ...(integer(usage.reasoningOutputTokens)?{output_tokens_details:{reasoning_tokens:usage.reasoningOutputTokens}}:{}),
   rawProviderUsage:rawUsage};
  let receipt;
  try{
   receipt=await ledger.settle(scope,{requestId,usage:normalized,
    providerReference:observed?.usageEvidence?.providerReference||'local-attempt:'+requestId,failed:Boolean(providerError)});
  }catch{
   // If COMMIT succeeded but its acknowledgement was lost, markUnknown refuses
   // to rewrite the settled entry. Either outcome pauses rather than reissues.
   await ledger.markUnknown(scope,{requestId,evidence:{reason:'settlement_unconfirmed'}}).catch(()=>{});
   throw pending();
  }
  if(providerError)throw providerError;
  return {...response,billing:{requestId,entryId:receipt.receipt.id,charged:receipt.receipt.delta,unit:'credit_minor'}};
 }});
}
