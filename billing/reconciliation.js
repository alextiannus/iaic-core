const fail=(message,statusCode)=>Object.assign(new Error(message),{statusCode});
// The host resolves a verified provider/export source, never model claims or a
// bare HTTP status. Only the source adapter chooses account and original call.
export class UsageReconciler {
 constructor({ledger,authorize,resolveSource}){Object.assign(this,{ledger,authorize,resolveSource});}
 async reconcile(actor,{sourceId}){
  if(typeof sourceId!=='string'||!sourceId.trim()||sourceId.length>400)throw fail('Usage evidence source identity required',400);
  if(await this.authorize(actor,{sourceId})!==true)throw fail('Usage reconciliation denied',403);
  const source=await this.resolveSource(sourceId,{actor});
  if(source?.sourceId!==sourceId||source.confirmed!==true)throw fail('Usage evidence is not confirmed',409);
  if(source.outcome==='not_accepted'&&source.providerAccepted!==false)throw fail('Definitive provider non-acceptance required',409);
  return this.ledger.reconcile(source.scope,{sourceId,requestId:source.requestId,outcome:source.outcome,providerReference:source.providerReference,usage:source.usage??null,failed:source.failed??true,evidence:source.evidence});
 }
}
