const fail=message=>Object.assign(new Error(message),{statusCode:400});
export function rateLimitedModel({model,rates,maximumTokens}){
 if(typeof model?.next!=='function'||typeof rates?.admit!=='function'||typeof rates?.finish!=='function'||typeof maximumTokens!=='function')throw fail('Model, rate ports and trusted Token bound resolver required');
 return Object.freeze({...model,async next(request){
  let receipt;
  try{request.signal?.throwIfAborted();const maximum=await maximumTokens(request);request.signal?.throwIfAborted();receipt=await rates.admit({...request.billingContext,maximumTokens:maximum});}
  catch(error){throw Object.assign(error,{providerNotCalled:true});}
  const finish=async input=>{try{await rates.finish(receipt.id,input);return true;}catch{return false;}};
  if(request.signal?.aborted){await finish({notCalled:true,evidence:{kind:'cancelled-before-provider'}});throw Object.assign(fail('Model call cancelled before dispatch'),{providerNotCalled:true,rateReservationId:receipt.id});}
  let response,error;try{response=await model.next(request);}catch(value){error=value;}
  const usage=(error||response)?.usage;let confirmed=false;
  if(error?.providerNotCalled===true)confirmed=await finish({notCalled:true,evidence:{kind:'provider-not-called'}});
  else if(Number.isSafeInteger(usage?.inputTokens)&&usage.inputTokens>=0&&Number.isSafeInteger(usage?.outputTokens)&&usage.outputTokens>=0&&Number.isSafeInteger(usage.inputTokens+usage.outputTokens))confirmed=await finish({actualTokens:usage.inputTokens+usage.outputTokens,evidence:{kind:'provider-usage'}});
  if(error)throw Object.assign(error,{rateReservationId:receipt.id,rateSettlementConfirmed:confirmed});
  return {...response,rate:{reservationId:receipt.id,settlementConfirmed:confirmed}};
 }});
}
