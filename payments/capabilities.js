import {defineCapability} from '../capabilities/index.js';
export function createPaymentCapabilities({payments,prefix='payments'}){
 const id={type:'string',minLength:1,maxLength:500};
 return [
  ['issue','write',{sourceId:id},['sourceId']],['read','read',{invoiceId:id},['invoiceId']],
  ['get','read',{id},['id']],['history','read',{id},['id']],
  ['charge','write',{invoiceId:id},['invoiceId']],
  ['refund','write',{invoiceId:id,paymentId:id,amount:{type:'string',pattern:'^[1-9][0-9]{0,29}$'}},['invoiceId','paymentId','amount']],
  ['reconcile','write',{id},['id']],['cancel','write',{id},['id']]
 ].map(([action,effect,properties,required])=>defineCapability({name:prefix+'.'+action,description:`${action} a scoped monetary invoice or payment operation. Money uses integer minor units and a currency, separate from platform allowance and provider tokens. Unknown operations require reconciliation; a receipt does not imply payment success.`,input:{type:'object',properties,required,additionalProperties:false},output:{type:action==='history'?'array':'object'},effect,...(effect==='write'?{retry:'never-replay'}:{}),authorize:async()=>true,implementation:{kind:'function',execute:(input,{actor,callId,signal})=>payments[action](actor,{...input,...(['charge','refund'].includes(action)?{requestKey:callId}:{})},{signal})}}));
}
