import fs from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
const fail=(message,statusCode=409)=>Object.assign(new Error(message),{statusCode});
const key=v=>{if(typeof v!=='string'||!v.trim()||v.length>500)throw fail('Budget identity required');return v;};
const units=v=>{if(typeof v!=='string'||! /^(0|[1-9][0-9]{0,23})$/.test(v))throw fail('Integer platform units required');return v;};
// Trusted policy/store port; uses the existing ledger account transaction/lock.
export class AllowanceBudgets {
 constructor({ledger}){this.ledger=ledger;}
 async initialize(){await this.ledger.pool.query(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));}
 async create(scope,{id,maximum,executors,deadlineAt,overflow}){
  key(id);units(maximum);
  if(!Array.isArray(executors)||!executors.length||executors.length>100||new Set(executors).size!==executors.length||executors.some(v=>{try{key(v);return false;}catch{return true;}})||!Number.isFinite(Date.parse(deadlineAt))||overflow!=='platform_absorbs')throw fail('Executors, deadline and explicit platform_absorbs policy required');
  const terms={maximum,executors:[...executors].sort(),deadlineAt:new Date(deadlineAt).toISOString(),overflow};
  return this.ledger.transaction(scope,async(c,account)=>{
   await c.query('INSERT INTO iaic_allowance_budgets(application_id,subject_id,id,terms) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[...account,id,terms]);
   const row=await this.row(c,account,id);if(!isDeepStrictEqual(row.terms,terms))throw fail('Budget ID belongs to different terms');return row;
  });
 }
 async row(c,account,id){const row=(await c.query('SELECT id,terms,revoked FROM iaic_allowance_budgets WHERE application_id=$1 AND subject_id=$2 AND id=$3',[...account,key(id)])).rows[0];if(!row)throw fail('Allowance budget unavailable',404);return row;}
 async revoke(scope,id){return this.ledger.transaction(scope,async(c,account)=>{await this.row(c,account,id);await c.query('UPDATE iaic_allowance_budgets SET revoked=true WHERE application_id=$1 AND subject_id=$2 AND id=$3',[...account,id]);return this.row(c,account,id);});}
 async usage(c,account,id){return (await c.query(`SELECT
 COALESCE(sum(CASE WHEN t.state IN ('reserved','unknown') THEN t.reserved ELSE 0 END),0)::text AS held,
 COALESCE(sum(-e.delta),0)::text AS spent
 FROM iaic_token_calls t LEFT JOIN iaic_token_entries e ON e.application_id=t.application_id AND e.subject_id=t.subject_id AND e.kind='settlement' AND e.reference=t.request_id
 WHERE t.application_id=$1 AND t.subject_id=$2 AND t.budget->>'id'=$3`,[...account,id])).rows[0];}
 async read(scope,id){return this.ledger.transaction(scope,async(c,account)=>{const row=await this.row(c,account,id),usage=await this.usage(c,account,id);return {...row,...usage,available:String(BigInt(row.terms.maximum)-BigInt(usage.spent)-BigInt(usage.held)),unit:'platform_allowance'};});}
 async admit(c,account,binding,maximum){
  if(!binding||Object.keys(binding).some(k=>!['id','executor'].includes(k)))throw fail('Explicit budget and executor binding required');key(binding.id);key(binding.executor);
  const row=await this.row(c,account,binding.id);
  if(row.terms.overflow!=='platform_absorbs'||row.revoked||Date.parse(row.terms.deadlineAt)<=Date.now()||!row.terms.executors.includes(binding.executor))throw fail('Budget revoked, expired or executor excluded',403);
  const usage=await this.usage(c,account,binding.id);
  if(BigInt(usage.spent)+BigInt(usage.held)+BigInt(maximum)>BigInt(row.terms.maximum))throw Object.assign(fail('Shared platform allowance budget exhausted',402),{code:'ALLOWANCE_BUDGET_EXHAUSTED'});
 }
}
