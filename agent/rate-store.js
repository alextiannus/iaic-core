import fs from 'node:fs/promises';import {randomUUID} from 'node:crypto';
const fail=(message,statusCode=400,code)=>Object.assign(new Error(message),{statusCode,code});
const key=v=>typeof v==='string'&&v.trim()&&v.length<=200;
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export class PostgresModelRateLimits {
 constructor({pool,namespace,requestsPerMinute,tokensPerMinute}){
  if(!pool||!key(namespace)||!Number.isInteger(requestsPerMinute)||requestsPerMinute<1||requestsPerMinute>2147483647||!Number.isSafeInteger(tokensPerMinute)||tokensPerMinute<1)throw fail('Rate pool, namespace and positive request/Token limits required');
  Object.assign(this,{pool,namespace,requestsPerMinute,tokensPerMinute});
 }
 async initialize(){await this.pool.query(await fs.readFile(new URL('./rate-schema.sql',import.meta.url),'utf8'));await this.pool.query('INSERT INTO iaic_model_rate_pools(namespace,requests_per_minute,tokens_per_minute) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[this.namespace,this.requestsPerMinute,this.tokensPerMinute]);await this.checkConfiguration();}
 async checkConfiguration(db=this.pool){const row=(await db.query('SELECT * FROM iaic_model_rate_pools WHERE namespace=$1',[this.namespace])).rows[0];if(row?.requests_per_minute!==this.requestsPerMinute||Number(row?.tokens_per_minute)!==this.tokensPerMinute)throw fail('Rate namespace has another configuration',409);}
 async admit({taskId,turn,maximumTokens}){
  if(!key(taskId)||!Number.isInteger(turn)||turn<1||turn>2147483647||!Number.isSafeInteger(maximumTokens)||maximumTokens<1||maximumTokens>this.tokensPerMinute)throw fail('Trusted Task turn and bounded maximum Tokens required');
  const db=await this.pool.connect();
  try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['model-rate',this.namespace])]);await this.checkConfiguration(db);
   if((await db.query('SELECT id FROM iaic_model_rate_reservations WHERE namespace=$1 AND task_id=$2 AND turn=$3',[this.namespace,taskId,turn])).rowCount)throw fail('Original Task turn already has a rate receipt; do not replay',409,'MODEL_TURN_ALREADY_ADMITTED');
   const clock=(await db.query("SELECT date_trunc('minute',statement_timestamp()) AS start,ceil(extract(epoch FROM (date_trunc('minute',statement_timestamp())+interval '1 minute'-statement_timestamp()))*1000)::integer AS wait")).rows[0];
   const used=(await db.query("SELECT count(*) AS requests,COALESCE(sum(CASE WHEN state='settled' THEN actual_tokens ELSE reserved_tokens END),0) AS tokens FROM iaic_model_rate_reservations WHERE namespace=$1 AND window_start=$2 AND state<>'not-called'",[this.namespace,clock.start])).rows[0];
   if(Number(used.requests)>=this.requestsPerMinute||BigInt(used.tokens)+BigInt(maximumTokens)>BigInt(this.tokensPerMinute))throw Object.assign(fail('Model admission rate limit reached',429,'MODEL_RATE_LIMITED'),{providerStatus:429,retryAfterMs:clock.wait});
   const row=(await db.query("INSERT INTO iaic_model_rate_reservations(id,namespace,task_id,turn,window_start,reserved_tokens,state) VALUES($1,$2,$3,$4,$5,$6,'reserved') RETURNING *",[randomUUID(),this.namespace,taskId,turn,clock.start,maximumTokens])).rows[0];await db.query('COMMIT');return row;
  }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}
 }
 async finish(id,{actualTokens=null,notCalled=false,evidence}){
  if(!uuid(id)||typeof notCalled!=='boolean'||(notCalled?actualTokens!==null:!Number.isSafeInteger(actualTokens)||actualTokens<0)||!evidence||typeof evidence!=='object'||Array.isArray(evidence)||Buffer.byteLength(JSON.stringify(evidence))>8000)throw fail('Rate receipt and bounded usage/non-dispatch evidence required');
  const state=notCalled?'not-called':'settled',db=await this.pool.connect();
  try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['model-rate',this.namespace])]);
   const row=(await db.query('SELECT * FROM iaic_model_rate_reservations WHERE namespace=$1 AND id=$2 FOR UPDATE',[this.namespace,id])).rows[0];if(!row)throw fail('Rate receipt not found',404);
   if(row.state!=='reserved'){
    if(row.state!==state||(state==='settled'&&Number(row.actual_tokens)!==actualTokens))throw fail('Rate receipt already has different terminal usage',409);
    await db.query('COMMIT');return row;
   }
   const changed=(await db.query('UPDATE iaic_model_rate_reservations SET state=$3,actual_tokens=$4,evidence=$5 WHERE namespace=$1 AND id=$2 RETURNING *',[this.namespace,id,state,actualTokens,evidence])).rows[0];await db.query('COMMIT');return changed;
  }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}
 }
 async get(id){if(!uuid(id))throw fail('Rate receipt ID required');const row=(await this.pool.query('SELECT * FROM iaic_model_rate_reservations WHERE namespace=$1 AND id=$2',[this.namespace,id])).rows[0];if(!row)throw fail('Rate receipt not found',404);return row;}
}
