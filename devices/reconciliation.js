import {key,fail} from '../releases/store.js';
import {defineCapability} from '../capabilities/index.js';
import {jsonValue} from '../evaluation/runner.js';
export class DeviceOperationReconciliation{
 constructor({store,sourceScope,resolveOwner,resolveSource,authorize}){
  if(typeof store?.get!=='function'||typeof store?.complete!=='function'||typeof resolveOwner!=='function'||typeof resolveSource!=='function'||typeof authorize!=='function')throw fail('Device reconciliation requires original store and trusted source/authorization ports');
  Object.assign(this,{store,sourceScope:key(sourceScope),resolveOwner,resolveSource,authorize});
 }
 async resolve(actor,{deviceId,requestKey,sourceId}){
  [deviceId,requestKey,sourceId].forEach(key);const input={deviceId,requestKey,sourceId};
  const check=async()=>{if(await this.authorize(actor,input)!==true)throw fail('Device reconciliation denied',403);return key(await this.resolveOwner(actor));};
  const owner=await check(),receipt=await this.store.get(owner,requestKey);if(receipt.deviceId!==deviceId)throw fail('Device receipt binding differs',409);
  if(receipt.result){if(receipt.result.evidence?.sourceId&&receipt.result.evidence.sourceId!==sourceId)throw fail('Original reconciliation uses another source',409);if(await check()!==owner)throw fail('Device reconciliation owner changed',403);return {deviceId,requestKey,...receipt.result};}
  const source=jsonValue(await this.resolveSource(actor,{...input,owner,sourceScope:this.sourceScope,operationDigest:receipt.digest}));
  if(!source||source.confirmed!==true||source.driverTerminal!==true||source.sourceScope!==this.sourceScope||source.owner!==owner||source.sourceId!==sourceId||source.deviceId!==deviceId||source.requestKey!==requestKey||source.operationDigest!==receipt.digest||!['submitted','not-executed'].includes(source.status)||typeof source.reference!=='string'||!source.reference.trim()||source.reference.length>2000)throw fail('Original device action and driver termination are not confirmed',409);
  if(await check()!==owner)throw fail('Device reconciliation owner changed',403);
  const result={status:source.status,evidence:{sourceId,sourceScope:this.sourceScope,reference:source.reference,operationDigest:receipt.digest,driverTerminal:true}};
  const saved=await this.store.complete(owner,requestKey,result);return {deviceId,requestKey,...saved.result};
 }
}
export function createDeviceReconciliationCapability({reconciliation,name='browser.reconcile'}){
 const key={type:'string',minLength:1,maxLength:500};
 return defineCapability({name,description:'Reconcile one original browser operation from a host-verified source and driver termination evidence. It never replays an action, and current page appearance does not prove non-execution.',input:{type:'object',properties:{deviceId:key,requestKey:key,sourceId:key},required:['deviceId','requestKey','sourceId'],additionalProperties:false},output:{type:'object'},effect:'write',retry:'idempotent',authorize:async()=>true,revalidate:(input,_old,{actor})=>reconciliation.resolve(actor,input),implementation:{kind:'function',execute:(input,{actor})=>reconciliation.resolve(actor,input)}});
}
