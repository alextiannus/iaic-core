// Core read contract. The application supplies authenticated account resolution;
// this module has no ERP, UI, HTTP or Assistant lifecycle dependency.
export class WalletReader {
 constructor({ledger,resolveScope,enforced=()=>false}){Object.assign(this,{ledger,resolveScope,enforced});}
 async read(actor,{before=null}={}){
  const scope=await this.resolveScope(actor);
  const [balance,rows,pending]=await Promise.all([this.ledger.balance(scope),this.ledger.entries(scope,{limit:50,before}),this.ledger.pending(scope)]);
  const entries=rows.map(row=>({id:row.id,kind:row.kind,delta:row.delta,createdAt:row.created_at,reference:row.reference,mode:row.evidence.mode||null,usage:row.evidence.usage?{inputTokens:row.evidence.usage.input_tokens??null,outputTokens:row.evidence.usage.output_tokens??null,cachedInputTokens:row.evidence.usage.input_tokens_details?.cached_tokens??null,reasoningOutputTokens:row.evidence.usage.output_tokens_details?.reasoning_tokens??null}:null,failed:row.evidence.failed===true}));
  return {balance:{...balance,enforced:this.enforced()},entries,pending,nextCursor:rows.length===50?rows.at(-1).id:null};
 }
 tool(actor){return {name:'my_get_assistant_wallet',description:'Read this user platform allowance, usage entries and unresolved reservations.',inputSchema:{type:'object',properties:{before:{type:'string'}},additionalProperties:false},handler:input=>this.read(actor,input)};}
}
