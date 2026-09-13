import fs from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const text=value=>typeof value==='string'&&value.trim()&&value.length<=500;
function identity(scope){
 const values=[scope?.applicationId,scope?.subjectId];
 if(!values.every(text))throw fail('Trusted billing account required',401);return values;
}
function units(value){
 if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)value=String(value);
 if(typeof value!=='string'||! /^(0|[1-9][0-9]{0,23})$/.test(value))throw fail('Nonnegative integer credit units required');
 return BigInt(value);
}
function document(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Buffer.byteLength(JSON.stringify(value))>16000)throw fail('Bounded evidence object required');
 return JSON.parse(JSON.stringify(value));
}
function pricing(value){
 if(!text(value?.revision))throw fail('Immutable price revision required');
 return {revision:value.revision,input:String(units(value.input)),cachedInput:String(units(value.cachedInput)),output:String(units(value.output))};
}
function cost(usage,price){
 const input=units(usage.input_tokens),output=units(usage.output_tokens);
 const cached=units(usage.input_tokens_details?.cached_tokens??0);
 if(cached>input)throw fail('Cached input exceeds input usage');
 // Reasoning tokens are already included in output_tokens, never charged twice.
 return (input-cached)*BigInt(price.input)+cached*BigInt(price.cachedInput)+output*BigInt(price.output);
}

// Headless Core primitive. Only trusted application/payment adapters may grant
// credits or choose account, price and attribution. Never expose these methods
// directly as model tools or accept account identity from a request body.
export class TokenLedger {
 constructor({pool}){this.pool=pool;}
 async initialize(){await this.pool.query(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));}
 async transaction(scope,fn){
  const account=identity(scope),client=await this.pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('INSERT INTO iaic_token_accounts VALUES($1,$2) ON CONFLICT DO NOTHING',account);
   await client.query('SELECT 1 FROM iaic_token_accounts WHERE application_id=$1 AND subject_id=$2 FOR UPDATE',account);
   const result=await fn(client,account);await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 async hasPendingTask(scope,taskId){
  if(!text(taskId))throw fail('Task identity required');
  return (await this.pool.query("SELECT 1 FROM iaic_token_calls WHERE application_id=$1 AND subject_id=$2 AND attribution->>'taskId'=$3 AND state IN ('reserved','unknown') LIMIT 1",[...identity(scope),taskId])).rowCount>0;
 }
 async taskUsage(scope,taskId){
  if(!text(taskId))throw fail('Task identity required');
  const row=(await this.pool.query(`SELECT count(*)::text AS requests,
   count(*) FILTER(WHERE c.state IN('reserved','unknown') OR (c.state='settled' AND e.id IS NULL))::text AS pending,
   COALESCE(sum(-e.delta),0)::text AS "platformUnits",
   COALESCE(sum((e.evidence->'usage'->>'input_tokens')::numeric+(e.evidence->'usage'->>'output_tokens')::numeric),0)::text AS "providerTokens"
   FROM iaic_token_calls c LEFT JOIN iaic_token_entries e ON e.application_id=c.application_id AND e.subject_id=c.subject_id AND e.kind='settlement' AND e.reference=c.request_id
   WHERE c.application_id=$1 AND c.subject_id=$2 AND c.attribution->>'taskId'=$3`,[...identity(scope),taskId])).rows[0];
  return {...row,complete:row.pending==='0'};
 }
 async balance(scope){return this.readBalance(this.pool,identity(scope));}
 async readBalance(client,account){
  const {rows:[row]}=await client.query(`SELECT
   COALESCE((SELECT sum(delta) FROM iaic_token_entries WHERE application_id=$1 AND subject_id=$2),0)::text AS balance,
   COALESCE((SELECT sum(reserved) FROM iaic_token_calls WHERE application_id=$1 AND subject_id=$2 AND state IN ('reserved','unknown')),0)::text AS reserved`,account);
  return {...row,available:String(BigInt(row.balance)-BigInt(row.reserved)),unit:'credit_minor'};
 }
 async entries(scope,{limit=50,before=null}={}){
  if(!Number.isInteger(limit)||limit<1||limit>100)throw fail('Invalid ledger limit');
  if(before!==null&&(typeof before!=='string'||! /^[1-9][0-9]{0,18}$/.test(before)||BigInt(before)>9223372036854775807n))throw fail('Invalid ledger cursor');
  return (await this.pool.query('SELECT * FROM iaic_token_entries WHERE application_id=$1 AND subject_id=$2 AND ($4::bigint IS NULL OR id<$4) ORDER BY id DESC LIMIT $3',[...identity(scope),limit,before])).rows;
 }
 async pending(scope){return (await this.pool.query("SELECT request_id,mode,reserved,state,created_at,attribution->>'taskId' AS task_id FROM iaic_token_calls WHERE application_id=$1 AND subject_id=$2 AND state IN ('reserved','unknown') ORDER BY created_at DESC LIMIT 50",identity(scope))).rows;}
 async grant(scope,{reference,amount,evidence}){
  if(!text(reference)||units(amount)===0n)throw fail('Positive grant and unique source required');
  const delta=String(units(amount)),proof=document(evidence);
  return this.transaction(scope,async(client,account)=>{
   await this.entry(client,account,'grant',reference,delta,proof);return this.readBalance(client,account);
  });
 }
 // A confirmed source is bound once across this application, including owner.
 async issue(scope,{sourceId,amount,evidence}){
  if(!text(sourceId)||sourceId.length>400||units(amount)===0n)throw fail('Confirmed source identity and positive allowance required');
  const delta=String(units(amount)),proof=document(evidence);
  return this.transaction(scope,async(client,account)=>{
   await client.query(`INSERT INTO iaic_token_issuances(application_id,source_id,subject_id,amount,evidence)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[account[0],sourceId,account[1],delta,proof]);
   const previous=(await client.query('SELECT subject_id,amount,evidence FROM iaic_token_issuances WHERE application_id=$1 AND source_id=$2',[account[0],sourceId])).rows[0];
   if(previous.subject_id!==account[1]||previous.amount!==delta||!isDeepStrictEqual(previous.evidence,proof))throw fail('Allowance source is already bound to different issuance details',409);
   await this.entry(client,account,'grant','issuance:'+sourceId,delta,proof);
   return {sourceId,...await this.readBalance(client,account)};
  });
 }
 async entry(client,account,kind,reference,delta,evidence){
  const previous=(await client.query('SELECT * FROM iaic_token_entries WHERE application_id=$1 AND subject_id=$2 AND kind=$3 AND reference=$4',[...account,kind,reference])).rows[0];
  if(previous){
   if(previous.delta!==delta||!isDeepStrictEqual(previous.evidence,evidence))throw fail('Ledger reference reused with different evidence',409);
   return previous;
  }
  return (await client.query('INSERT INTO iaic_token_entries(application_id,subject_id,kind,reference,delta,evidence) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[...account,kind,reference,delta,evidence])).rows[0];
 }
 async reserve(scope,{requestId,mode,maximum,price,attribution}){
  if(!text(requestId)||!['SYSTEM_MANAGED','BYOK'].includes(mode))throw fail('Call identity and credential mode required');
  const reserved=String(units(maximum)),snapshot=pricing(price),owner=document(attribution);
  if(mode==='BYOK'&&reserved!=='0')throw fail('BYOK cannot reserve system credits');
  if(mode==='SYSTEM_MANAGED'&&reserved==='0')throw fail('System call requires positive reservation');
  return this.transaction(scope,async(client,account)=>{
   const existing=await this.call(client,account,requestId,false);
   if(existing){
    if(existing.mode!==mode||existing.reserved!==reserved||!isDeepStrictEqual(existing.price,snapshot)||!isDeepStrictEqual(existing.attribution,owner))throw fail('Model request identity reused',409);
    return {...existing,replayed:true};
   }
   if(mode==='SYSTEM_MANAGED'&&BigInt((await this.readBalance(client,account)).available)<BigInt(reserved))throw Object.assign(fail('Token balance insufficient; add credits or select your own model',402),{code:'TOKEN_BALANCE_INSUFFICIENT'});
   return {...(await client.query('INSERT INTO iaic_token_calls(application_id,subject_id,request_id,mode,reserved,price,attribution) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[...account,requestId,mode,reserved,snapshot,owner])).rows[0],replayed:false};
  });
 }
 async call(client,account,id,required=true){
  if(!text(id))throw fail('Model request identity required');
  const row=(await client.query('SELECT * FROM iaic_token_calls WHERE application_id=$1 AND subject_id=$2 AND request_id=$3',[...account,id])).rows[0];
  if(!row&&required)throw fail('Model reservation unavailable',404);return row;
 }
 async settle(scope,{requestId,usage,providerReference,failed=false}){
  if(!text(providerReference)||typeof failed!=='boolean')throw fail('Provider evidence reference required');
  const raw=document(usage);
  return this.transaction(scope,(client,account)=>this.settleCall(client,account,{requestId,raw,providerReference,failed}));
 }
 async settleCall(client,account,{requestId,raw,providerReference,failed,reconciliation=null}){
  const call=await this.call(client,account,requestId);
  if(call.state==='released')throw fail('Released call cannot settle',409);
  const ratedCredits=cost(raw,call.price),charged=call.mode==='BYOK'?0n:ratedCredits;
  if(charged>=10n**30n||ratedCredits>=10n**30n)throw fail('Usage cost exceeds ledger range');
  const evidence={usage:raw,providerReference,failed,mode:call.mode,price:call.price,ratedCredits:String(ratedCredits),reservationExceeded:charged>BigInt(call.reserved),...(reconciliation?{reconciliation}:{})};
  const receipt=await this.entry(client,account,'settlement',requestId,String(-charged),evidence);
  await client.query("UPDATE iaic_token_calls SET state='settled' WHERE application_id=$1 AND subject_id=$2 AND request_id=$3",[...account,requestId]);
  // Actual usage may exceed reservation: preserve debt rather than discard it.
  return {receipt,...await this.readBalance(client,account)};
 }
 // Trusted reconciliation port. The source is immutable and belongs to one
 // original request/account. It cannot issue credits or change the pinned rate.
 async reconcile(scope,{sourceId,requestId,outcome,providerReference,usage=null,failed=true,evidence}){
  if(!text(sourceId)||sourceId.length>400||!text(requestId)||!text(providerReference)||!['measured','not_accepted'].includes(outcome)||typeof failed!=='boolean')throw fail('Confirmed usage source and original request required');
  if(outcome==='not_accepted'&&usage!==null)throw fail('Non-acceptance cannot include measured usage');
  const proof=document({outcome,providerReference,usage:outcome==='measured'?document(usage):null,failed,evidence:document(evidence)});
  return this.transaction(scope,async(client,account)=>{
   const call=await this.call(client,account,requestId);
   await client.query(`INSERT INTO iaic_token_reconciliations(application_id,source_id,subject_id,request_id,evidence)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[account[0],sourceId,account[1],requestId,proof]);
   const prior=(await client.query('SELECT subject_id,request_id,evidence FROM iaic_token_reconciliations WHERE application_id=$1 AND source_id=$2',[account[0],sourceId])).rows[0];
   if(!prior||prior.subject_id!==account[1]||prior.request_id!==requestId||!isDeepStrictEqual(prior.evidence,proof))throw fail('Usage source or request already bound to different reconciliation',409);
   const kind=outcome==='measured'?'settlement':'release';
   const previous=(await client.query('SELECT * FROM iaic_token_entries WHERE application_id=$1 AND subject_id=$2 AND kind=$3 AND reference=$4',[...account,kind,requestId])).rows[0];
   if(previous){
    if(!isDeepStrictEqual(previous.evidence.reconciliation,{sourceId,evidence:proof.evidence}))throw fail('Request already finalized by another source',409);
    return {sourceId,requestId,outcome,receipt:previous,...await this.readBalance(client,account)};
   }
   if(!['reserved','unknown'].includes(call.state))throw fail('Request already finalized',409);
   const reconciliation={sourceId,evidence:proof.evidence};
   let result;
   if(outcome==='measured')result=await this.settleCall(client,account,{requestId,raw:proof.usage,providerReference,failed,reconciliation});
   else{
    const receipt=await this.entry(client,account,'release',requestId,'0',{providerAccepted:false,reference:providerReference,mode:call.mode,reconciliation});
    await client.query("UPDATE iaic_token_calls SET state='released' WHERE application_id=$1 AND subject_id=$2 AND request_id=$3",[...account,requestId]);
    result={receipt,...await this.readBalance(client,account)};
   }
   return {sourceId,requestId,outcome,...result};
  });
 }
 async markUnknown(scope,{requestId,evidence}){
  const proof=document(evidence);
  return this.transaction(scope,async(client,account)=>{
   const call=await this.call(client,account,requestId);
   if(!['reserved','unknown'].includes(call.state))throw fail('Call is already finalized',409);
   await this.entry(client,account,'unknown',requestId,'0',proof);
   await client.query("UPDATE iaic_token_calls SET state='unknown' WHERE application_id=$1 AND subject_id=$2 AND request_id=$3",[...account,requestId]);
   return this.readBalance(client,account);
  });
 }
 // Release requires trusted proof the provider did not accept the request.
 // An uncertain accepted request must remain held until usage reconciliation.
 async release(scope,{requestId,evidence}){
  const proof=document(evidence);
  if(proof.providerAccepted!==false||!text(proof.reference))throw fail('Definitive non-acceptance evidence required');
  return this.transaction(scope,async(client,account)=>{
   const call=await this.call(client,account,requestId);
   if(!['reserved','released'].includes(call.state))throw fail('Unknown or settled usage cannot be released',409);
   await this.entry(client,account,'release',requestId,'0',proof);
   await client.query("UPDATE iaic_token_calls SET state='released' WHERE application_id=$1 AND subject_id=$2 AND request_id=$3",[...account,requestId]);
   return this.readBalance(client,account);
  });
 }
}
