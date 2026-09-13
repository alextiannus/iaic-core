const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export function capacityModel({model,capacity}){
 if(typeof model?.next!=='function'||typeof capacity?.admit!=='function'||typeof capacity?.release!=='function')throw fail('Model and capacity admission ports required');
 return Object.freeze({...model,async next(request){
  let receipt;
  try{request.signal?.throwIfAborted();receipt=await capacity.admit(request.billingContext||{});}catch(error){throw Object.assign(error,{providerNotCalled:true});}
  const release=async evidence=>{try{await capacity.release(receipt.id,evidence);return true;}catch{return false;}};
  if(request.signal?.aborted){await release({kind:'not-dispatched'});throw Object.assign(fail('Model request cancelled before provider dispatch',409),{providerNotCalled:true});}
  let result;
  try{result=await model.next(request);}catch(error){
   // Transport errors/timeouts do not prove the provider stopped generating.
   if(error.providerNotCalled===true)await release({kind:'provider-not-called'});
   throw Object.assign(error,{capacityReservationId:receipt.id});
  }
  const releaseConfirmed=await release({kind:'provider-returned'});
  return {...result,capacity:{reservationId:receipt.id,releaseConfirmed}};
 }});
}
export class ModelCapacityReconciliation{
 constructor({capacity,resolveSource,authorize}){if(typeof capacity?.get!=='function'||typeof capacity?.release!=='function'||typeof resolveSource!=='function'||typeof authorize!=='function')throw fail('Capacity reconciliation requires trusted source and authorization ports');Object.assign(this,{capacity,resolveSource,authorize});}
 async resolve(actor,{reservationId,sourceId}){
  if(typeof sourceId!=='string'||!sourceId.trim()||sourceId.length>500)throw fail('Trusted reconciliation source required');
  if(await this.authorize(actor,{reservationId,sourceId})!==true)throw fail('Capacity reconciliation denied',403);
  const receipt=await this.capacity.get(reservationId),source=await this.resolveSource(actor,{reservationId,sourceId});
  if(!source||source.sourceId!==sourceId||source.reservationId!==reservationId||source.namespace!==receipt.namespace||source.confirmedTerminal!==true||!['not-started','finished'].includes(source.outcome))throw fail('Original provider request termination is not confirmed',409);
  if(await this.authorize(actor,{reservationId,sourceId})!==true)throw fail('Capacity reconciliation denied',403);
  return this.capacity.release(reservationId,{kind:'trusted-reconciliation',sourceId,outcome:source.outcome});
 }
}
