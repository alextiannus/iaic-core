import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
export const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export const key=value=>{if(typeof value!=='string'||!value.trim()||value.length>500)throw fail('Payment identifier required');return value;};
export const money=value=>{if(typeof value!=='string'||!/^[1-9][0-9]{0,29}$/.test(value))throw fail('Money must be a positive integer minor-unit string, at most 30 digits');return value;};
const invoice=row=>({id:row.id,sourceId:row.source_id,currency:row.currency,amount:row.amount});
const operation=row=>row?{id:row.id,invoiceId:row.invoice_id,paymentId:row.payment_id,scopeId:row.scope_id,requestKey:row.request_key,kind:row.kind,currency:row.currency,amount:row.amount,state:row.state,result:row.result}:null;
export class PostgresPaymentStore{
 constructor({pool,namespace}){this.pool=pool;this.namespace=key(namespace);}
 async initialize(){await this.pool.query(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));}
 async issue(scopeId,{sourceId,currency,amount}){
  key(scopeId);key(sourceId);money(amount);if(typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency))throw fail('Currency code required');
  const args=[this.namespace,scopeId,sourceId,currency,amount];
  const row=(await this.pool.query('INSERT INTO iaic_money_invoices(id,namespace,scope_id,source_id,currency,amount) VALUES($6,$1,$2,$3,$4,$5) ON CONFLICT(namespace,scope_id,source_id) DO NOTHING RETURNING *',[...args,randomUUID()])).rows[0]||(await this.pool.query('SELECT * FROM iaic_money_invoices WHERE namespace=$1 AND scope_id=$2 AND source_id=$3',args.slice(0,3))).rows[0];
  if(row.currency!==currency||row.amount!==amount)throw fail('Invoice source is bound to different money',409);return invoice(row);
 }
 async read(scopeId,id){
  const row=(await this.pool.query('SELECT * FROM iaic_money_invoices WHERE namespace=$1 AND scope_id=$2 AND id::text=$3',[this.namespace,key(scopeId),key(id)])).rows[0];if(!row)throw fail('Invoice not found',404);
  const rows=(await this.pool.query('SELECT * FROM iaic_money_operations WHERE invoice_id=$1 ORDER BY created_at,id',[row.id])).rows;
  let paid=0n,refunded=0n;for(const r of rows)if(r.state==='succeeded'){if(r.kind==='charge')paid+=BigInt(r.amount);else refunded+=BigInt(r.amount);}
  return {...invoice(row),paid:paid.toString(),refunded:refunded.toString(),netPaid:(paid-refunded).toString(),operations:rows.map(operation)};
 }
 async get(scopeId,id){const row=(await this.pool.query('SELECT * FROM iaic_money_operations WHERE namespace=$1 AND scope_id=$2 AND id::text=$3',[this.namespace,key(scopeId),key(id)])).rows[0];if(!row)throw fail('Payment operation not found',404);return operation(row);}
 async prepare(scopeId,{invoiceId,requestKey,kind,paymentId=null,amount=null}){
  [scopeId,invoiceId,requestKey].forEach(key);if(!['charge','refund'].includes(kind))throw fail('Invalid money operation');if(kind==='refund'){key(paymentId);money(amount);}
  const c=await this.pool.connect();try{
   await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([this.namespace,scopeId,requestKey])]);
   const bill=(await c.query('SELECT * FROM iaic_money_invoices WHERE namespace=$1 AND scope_id=$2 AND id::text=$3 FOR UPDATE',[this.namespace,scopeId,invoiceId])).rows[0];if(!bill)throw fail('Invoice not found',404);
   if(kind==='charge'){amount=bill.amount;paymentId=null;}
   const prior=(await c.query('SELECT * FROM iaic_money_operations WHERE namespace=$1 AND scope_id=$2 AND request_key=$3',[this.namespace,scopeId,requestKey])).rows[0];
   if(prior){if(prior.invoice_id!==invoiceId||prior.kind!==kind||prior.payment_id!==paymentId||prior.amount!==amount)throw fail('Payment key belongs to another intent',409);await c.query('COMMIT');return operation(prior);}
   const related=(await c.query("SELECT * FROM iaic_money_operations WHERE invoice_id=$1 AND state<>'failed'",[bill.id])).rows;
   if(kind==='charge'&&related.some(r=>r.kind==='charge'))throw fail('Invoice already has a paid, pending or unknown charge',409);
   if(kind==='refund'){
    const payment=related.find(r=>r.id===paymentId&&r.kind==='charge'&&r.state==='succeeded');if(!payment)throw fail('Refund requires a confirmed payment for this invoice',409);
    const reserved=related.filter(r=>r.kind==='refund'&&r.payment_id===paymentId).reduce((sum,r)=>sum+BigInt(r.amount),0n);
    if(reserved+BigInt(amount)>BigInt(payment.amount))throw fail('Refund exceeds unreserved captured amount',409);
   }
   const row=(await c.query('INSERT INTO iaic_money_operations(id,namespace,scope_id,request_key,invoice_id,kind,payment_id,currency,amount) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[randomUUID(),this.namespace,scopeId,requestKey,bill.id,kind,paymentId,bill.currency,amount])).rows[0];
   await c.query("INSERT INTO iaic_money_events(operation_id,kind,data) VALUES($1,'prepared',$2)",[row.id,{requestKey,kind,amount,currency:bill.currency}]);await c.query('COMMIT');return operation(row);
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
 }
 async claim(scopeId,id){
  const row=(await this.pool.query(`WITH changed AS (UPDATE iaic_money_operations SET state='running',updated_at=now() WHERE namespace=$1 AND scope_id=$2 AND id::text=$3 AND state='prepared' RETURNING *), recorded AS (INSERT INTO iaic_money_events(operation_id,kind,data) SELECT id,'running','{}'::jsonb FROM changed) SELECT * FROM changed`,[this.namespace,key(scopeId),key(id)])).rows[0];return operation(row);
 }
 async record(scopeId,id,result){
  const c=await this.pool.connect();try{await c.query('BEGIN');const row=(await c.query('SELECT * FROM iaic_money_operations WHERE namespace=$1 AND scope_id=$2 AND id::text=$3 FOR UPDATE',[this.namespace,key(scopeId),key(id)])).rows[0];if(!row)throw fail('Operation not found',404);
   if(!['succeeded','failed','unknown'].includes(result?.status)||result.operationId!==row.id||result.currency!==row.currency||result.amount!==row.amount)throw fail('Payment outcome does not match original intent',409);
   if(result.status==='succeeded'&&(typeof result.providerRef!=='string'||!result.providerRef))throw fail('Confirmed money movement requires provider reference',409);
   if(['succeeded','failed'].includes(row.state)){if(!isDeepStrictEqual(row.result,result))throw fail('Terminal payment evidence is immutable',409);await c.query('COMMIT');return operation(row);}
   if(!['running','unknown'].includes(row.state))throw fail('Operation was not dispatched',409);
   const updated=(await c.query('UPDATE iaic_money_operations SET state=$2,result=$3,updated_at=now() WHERE id=$1 RETURNING *',[row.id,result.status,result])).rows[0];
   await c.query('INSERT INTO iaic_money_events(operation_id,kind,data) VALUES($1,$2,$3)',[row.id,result.status,result]);await c.query('COMMIT');return operation(updated);
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
 }
 async cancel(scopeId,id){
  const result=(await this.pool.query(`WITH changed AS (UPDATE iaic_money_operations SET state='failed',result=jsonb_build_object('operationId',id::text,'status','failed','currency',currency,'amount',amount::text,'reason','cancelled-before-dispatch'),updated_at=now() WHERE namespace=$1 AND scope_id=$2 AND id::text=$3 AND state='prepared' RETURNING *), recorded AS (INSERT INTO iaic_money_events(operation_id,kind,data) SELECT id,'cancelled-before-dispatch',result FROM changed) SELECT * FROM changed`,[this.namespace,key(scopeId),key(id)])).rows[0];
  if(!result)throw fail('Only an undispatched payment intent can be cancelled; reconcile or refund dispatched work',409);return operation(result);
 }
 async history(scopeId,id){await this.get(scopeId,id);return (await this.pool.query('SELECT seq,kind,data,created_at FROM iaic_money_events WHERE operation_id=$1 ORDER BY seq',[id])).rows;}
}
