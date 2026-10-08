import {normalizeAction} from '../agent/model-action.js';
import {usageDiagnostic} from '../agent/usage-diagnostic.js';
import {providerCostBasis} from '../costs/provider.js';
import {randomUUID} from 'node:crypto';
const pending=()=>Object.assign(new Error('Model usage requires reconciliation before continuing'),{code:'USAGE_RECONCILIATION_REQUIRED',statusCode:409});

// One gateway wrapper per resolved account/model. Account, credential mode and
// platform allowance rates come from trusted configuration, never model output.
export function meteredModel({model,ledger,scope,policy,mode='SYSTEM_MANAGED'}){
 if(!policy?.price||policy.maximum===undefined)throw new Error('Platform allowance policy required');
 const continuation=policy.pendingUsage==='continue';
 if(policy.pendingUsage!==undefined&&!['continue','block'].includes(policy.pendingUsage))throw new Error('Invalid pending usage policy');
 if(continuation&&['recoverResult','hasBlockingTask'].some(key=>typeof ledger[key]!=='function'))throw new Error('Durable result ledger required');
 const resultResponse=row=>({...row.response,billing:{requestId:row.requestId,resultAvailable:true,usageState:row.state==='settled'?'confirmed':'pending',reconciliationRef:row.requestId,originalTurn:row.attribution.turn,providerReference:row.providerReference,unit:'credit_minor'}});
 const recover=async request=>{
  if(!Array.isArray(request.billingContext?.resultReceipts))throw new Error('Trusted Runtime result receipts required for continuation');
  const row=await ledger.recoverResult(scope,{taskId:request.billingContext.taskId,receipts:request.billingContext.resultReceipts,model:model.name,profile:model.profileId??null});
  return row?resultResponse(row):null;
 };
 const costBasis=policy.costBasis==null?null:providerCostBasis(policy.costBasis,{mode,model:model.model??model.name});
 return Object.freeze({metered:true,...(continuation?{recoverResult:recover}:{}),name:model.name,model:model.model,profileId:model.profileId,...(typeof model.checkReady==='function'?{checkReady:options=>model.checkReady(options)}:{}),async next(request){
  const context=request.billingContext;
  if(!context?.taskId||!Number.isInteger(context.turn))throw new Error('Trusted runtime billing context required');
  request.signal?.throwIfAborted();
  if(continuation){const retained=await recover(request);if(retained)return retained;}
  if(await ledger[continuation?'hasBlockingTask':'hasPendingTask'](scope,context.taskId))throw pending();
  if(typeof model.checkReady==='function')await model.checkReady({signal:request.signal});
  request.signal?.throwIfAborted();
  const requestId=randomUUID();
  await ledger.reserve(scope,{requestId,mode,maximum:mode==='BYOK'?0:policy.maximum,price:policy.price,budget:policy.budget??null,costBasis,
   attribution:{...Object.fromEntries(Object.entries(context).filter(([key])=>key!=='resultReceipts')),model:model.name,profile:model.profileId??null}});
  // A crash after reservation leaves a durable hold; never assume zero usage.
  if(request.signal?.aborted){
   await ledger.release(scope,{requestId,evidence:{providerAccepted:false,reference:'cancelled-before-dispatch'}});
   request.signal.throwIfAborted();
  }
  let response,providerError;
  try{response=await model.next(request);}catch(error){providerError=error;}
  if(providerError?.providerNotCalled){await ledger.release(scope,{requestId,evidence:{providerAccepted:false,reference:'provider-preflight'}});throw providerError;}
  const observed=providerError||response;
  const usage=observed?.usage;
  const integer=value=>Number.isSafeInteger(value)&&value>=0;
  let result=null;
  if(continuation&&!providerError){try{result=normalizeAction(response);if(Buffer.byteLength(JSON.stringify(result))>32000)result=null;}catch{result=null; /* malformed responses are not usable */ }}
  const reference=response?.usageEvidence?.providerReference;
  const providerReference=typeof reference==='string'&&reference.trim()&&reference.length<=500?reference:null;
  if(!integer(usage?.inputTokens)||!integer(usage?.outputTokens)){
   const diagnostic=usageDiagnostic({requestId,kind:!providerError?'missing_usage':Number.isInteger(providerError.providerStatus)?'http':providerError.name==='AbortError'?'aborted':providerError.name==='TimeoutError'?'timeout':'provider_error',providerStatus:providerError?.providerStatus,retryAfterMs:providerError?.retryAfterMs,providerCompleted:observed?.providerCompleted});
   await ledger.markUnknown(scope,{requestId,evidence:{reason:'usage_unavailable',diagnostic},...(result?{result,providerReference}:{})});
   if(result)return resultResponse({response:result,requestId,state:'unknown',attribution:context,providerReference});
   throw Object.assign(pending(),{usageDiagnostic:diagnostic});
  }
  const rawUsage=observed?.usageEvidence?.rawUsage??null;
  const normalized={input_tokens:usage.inputTokens,output_tokens:usage.outputTokens,
   ...(integer(usage.cachedInputTokens)?{input_tokens_details:{cached_tokens:usage.cachedInputTokens}}:{}),
   ...(integer(usage.reasoningOutputTokens)?{output_tokens_details:{reasoning_tokens:usage.reasoningOutputTokens}}:{}),
   rawProviderUsage:rawUsage};
  // Retain before settlement too: an unavailable acknowledgement must not discard
  // an otherwise usable response. The hold/result commit precedes consumption.
  if(result){
   result={...result,usage:{inputTokens:usage.inputTokens,outputTokens:usage.outputTokens}};
   await ledger.markUnknown(scope,{requestId,evidence:{reason:'settlement_pending',providerReference,diagnostic:{requestId},usage:{input_tokens:usage.inputTokens,output_tokens:usage.outputTokens,...(integer(usage.cachedInputTokens)?{input_tokens_details:{cached_tokens:usage.cachedInputTokens}}:{})}},result,providerReference});
  }
  let receipt;
  try{
   receipt=await ledger.settle(scope,{requestId,usage:normalized,
    providerReference:observed?.usageEvidence?.providerReference||'local-attempt:'+requestId,failed:Boolean(providerError)});
  }catch{
   if(result)return await recover(request);
   // If COMMIT succeeded but its acknowledgement was lost, markUnknown refuses
   // to rewrite the settled entry. Either outcome pauses rather than reissues.
   await ledger.markUnknown(scope,{requestId,evidence:{reason:'settlement_unconfirmed'}}).catch(()=>{});
   throw pending();
  }
  if(providerError)throw providerError;
  if(result){const retained=resultResponse({response:result,requestId,state:'settled',attribution:context,providerReference});return {...retained,billing:{...retained.billing,entryId:receipt.receipt.id,charged:receipt.receipt.delta}};}
  return {...response,billing:{requestId,entryId:receipt.receipt.id,charged:receipt.receipt.delta,unit:'credit_minor'}};
 }});
}
