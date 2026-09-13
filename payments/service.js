import {fail,key} from './store.js';
export class Payments{
 constructor({store,provider,resolveScope,authorize,resolveInvoice,timeoutMs=30000}){
  if(!store||['charge','refund','query'].some(k=>typeof provider?.[k]!=='function')||[resolveScope,authorize,resolveInvoice].some(f=>typeof f!=='function')||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000)throw new Error('Payments requires store, provider, identity, authorization and confirmed invoice-source ports');
  Object.assign(this,{store,provider,resolveScope,authorize,resolveInvoice,timeoutMs});
 }
 async scope(actor,action,input){if(await this.authorize(actor,{action,input})!==true)throw fail('Payment access denied',403);return key(await this.resolveScope(actor));}
 async issue(actor,{sourceId}){const scopeId=await this.scope(actor,'issue',{sourceId});const source=await this.resolveInvoice(key(sourceId),{actor,scopeId});if(!source||source.confirmed!==true||source.sourceId!==sourceId||source.scopeId!==scopeId)throw fail('Invoice source is not confirmed for this scope',409);return this.store.issue(scopeId,source);}
 async read(actor,{invoiceId}){return this.store.read(await this.scope(actor,'read',{invoiceId}),invoiceId);}
 async get(actor,{id}){return this.store.get(await this.scope(actor,'get',{id}),id);}
 async history(actor,{id}){return this.store.history(await this.scope(actor,'history',{id}),id);}
 async charge(actor,{invoiceId,requestKey},options={}){const scopeId=await this.scope(actor,'charge',{invoiceId});const op=await this.store.prepare(scopeId,{invoiceId,requestKey,kind:'charge'});return this.execute(actor,op,options);}
 async refund(actor,{invoiceId,paymentId,amount,requestKey},options={}){const scopeId=await this.scope(actor,'refund',{invoiceId,paymentId,amount});const op=await this.store.prepare(scopeId,{invoiceId,paymentId,amount,requestKey,kind:'refund'});return this.execute(actor,op,options);}
 async execute(actor,operation,{signal}={}){
  const scopeId=await this.scope(actor,operation.kind,operation);if(scopeId!==operation.scopeId)throw fail('Payment scope changed',409);signal?.throwIfAborted();
  const claimed=await this.store.claim(scopeId,operation.id);if(!claimed)return this.store.get(scopeId,operation.id);
  const result=await this.attempt(actor,claimed,claimed.kind,signal);return this.store.record(scopeId,claimed.id,result);
 }
 async reconcile(actor,{id},options={}){
  const scopeId=await this.scope(actor,'reconcile',{id}),op=await this.store.get(scopeId,id);
  if(['succeeded','failed'].includes(op.state))return op;
  if(op.state==='prepared')throw fail('Prepared operation has not been dispatched; cancel it or use its original request key',409);
  return this.store.record(scopeId,id,await this.attempt(actor,op,'query',options.signal));
 }
 async cancel(actor,{id}){const scopeId=await this.scope(actor,'cancel',{id});return this.store.cancel(scopeId,id);}
 async attempt(actor,op,method,callerSignal){
  const controller=new AbortController();const signal=callerSignal?AbortSignal.any([callerSignal,controller.signal]):controller.signal;
  const unknown=()=>({operationId:op.id,status:'unknown',amount:op.amount,currency:op.currency});
  if(signal.aborted)return unknown();
  let timer,abort;const stopped=new Promise((_,reject)=>{abort=()=>reject(new Error('Payment request interrupted'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();timer=setTimeout(()=>controller.abort(),this.timeoutMs);});
  try{
   signal.throwIfAborted();const raw=await Promise.race([this.provider[method](structuredClone(op),{actor,signal}),stopped]);
   if(!raw||!['succeeded','failed','unknown'].includes(raw.status)||raw.operationId!==op.id||raw.amount!==op.amount||raw.currency!==op.currency||(raw.status==='succeeded'&&(typeof raw.providerRef!=='string'||!raw.providerRef)))return unknown();
   // The provider owns detailed evidence; Core stores stable references, not payment credentials.
   return {operationId:op.id,status:raw.status,amount:op.amount,currency:op.currency,...(typeof raw.providerRef==='string'?{providerRef:raw.providerRef}:{})};
  }catch{return unknown();}finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
 }
}
