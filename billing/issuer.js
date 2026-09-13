const fail=(message,statusCode)=>Object.assign(new Error(message),{statusCode});
// resolveSource is a trusted host adapter (platform allocation, subscription or
// verified payment). Neither the model nor the claimant chooses amount/owner.
export class AllowanceIssuer{
 constructor({ledger,authorize,resolveSource}){Object.assign(this,{ledger,authorize,resolveSource});}
 async issue(actor,{sourceId}){
  if(typeof sourceId!=='string'||!sourceId.trim()||sourceId.length>400)throw fail('Allowance source identity required',400);
  if(await this.authorize(actor,{sourceId})!==true)throw fail('Allowance issuance denied',403);
  const source=await this.resolveSource(sourceId,{actor});
  if(!source||source.sourceId!==sourceId||source.confirmed!==true)throw fail('Allowance source is not confirmed',409);
  return this.ledger.issue(source.scope,{sourceId,amount:source.amount,evidence:source.evidence});
 }
}
