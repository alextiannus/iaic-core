import fs from 'node:fs/promises';import {randomUUID} from 'node:crypto';import {isDeepStrictEqual} from 'node:util';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const text=v=>typeof v==='string'&&v.trim()&&v.length<=500;
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const identity=scope=>{const values=[scope?.applicationId,scope?.assistantId,scope?.subjectId];if(!values.every(text))throw fail('Trusted deferred-task scope required',401);return values;};
const visible=row=>({id:row.id,requestKey:row.request_key,dueAt:new Date(row.trigger_not_before??row.due_at).toISOString(),input:row.input,trigger:row.trigger,triggerReceipt:row.trigger_receipt,state:row.state,attempts:row.attempts,taskId:row.task_id,lastError:row.last_error,admittedAt:row.admitted_at,createdAt:row.created_at});
export class DeferredTaskStore{
 constructor({pool,leaseMs=60000,retryMs=15000,maxAttempts=3}){
  if(!Number.isInteger(leaseMs)||leaseMs<1||!Number.isInteger(retryMs)||retryMs<0||!Number.isInteger(maxAttempts)||maxAttempts<1)throw new Error('Invalid deferred worker limits');Object.assign(this,{pool,leaseMs,retryMs,maxAttempts});
 }
 async initialize(){await this.pool.query(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));}
 async transaction(run){const c=await this.pool.connect();try{await c.query('BEGIN');const result=await run(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 async create(scope,{requestKey,dueAt,input,trigger=null}){
  if(!text(requestKey)||typeof dueAt!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(dueAt)||!Number.isFinite(Date.parse(dueAt))||!input||typeof input!=='object'||Array.isArray(input)||Buffer.byteLength(JSON.stringify(input))>24000)throw fail('Stable key, explicit timestamp and bounded task input required');
  if(trigger!==null&&(!trigger||typeof trigger!=='object'||Array.isArray(trigger)||Buffer.byteLength(JSON.stringify(trigger))>4000))throw fail('Bounded trigger reference required');
  const when=new Date(dueAt).toISOString(),account=identity(scope);
  return this.transaction(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['deferred',...account,requestKey])]);
   const prior=(await c.query('SELECT * FROM iaic_deferred_tasks WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND request_key=$4',[...account,requestKey])).rows[0];
   if(prior){if(new Date(prior.trigger_not_before??prior.due_at).toISOString()!==when||!isDeepStrictEqual(prior.input,input)||!isDeepStrictEqual(prior.trigger,trigger))throw fail('Deferred request key belongs to different input',409);return visible(prior);}
   return visible((await c.query('INSERT INTO iaic_deferred_tasks(id,application_id,assistant_id,subject_id,request_key,due_at,input,trigger,trigger_not_before) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[randomUUID(),...account,requestKey,trigger?'9999-12-31T23:59:59.999Z':when,input,trigger,trigger?when:null])).rows[0]);
  });
 }
 async get(scope,id){if(!uuid(id))throw fail('Invalid deferred task ID');const row=(await this.pool.query('SELECT * FROM iaic_deferred_tasks WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND id=$4',[...identity(scope),id])).rows[0];if(!row)throw fail('Deferred task not found',404);return visible(row);}
 async findRequest(scope,requestKey){if(!text(requestKey))throw fail('Invalid scheduled request key');const row=(await this.pool.query('SELECT * FROM iaic_deferred_tasks WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND request_key=$4',[...identity(scope),requestKey])).rows[0];return row?visible(row):null;}
 async list(scope,{after='',limit=20}={}){
  if((after!==''&&!uuid(after))||!Number.isInteger(limit)||limit<1||limit>50)throw fail('Invalid deferred-task page');
  const rows=(await this.pool.query('SELECT * FROM iaic_deferred_tasks WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND ($4::uuid IS NULL OR id>$4) ORDER BY id LIMIT $5',[...identity(scope),after||null,limit+1])).rows;const items=rows.slice(0,limit).map(visible);return {items,nextCursor:rows.length>limit?items.at(-1).id:null};
 }
 async change(scope,id,action){
  await this.get(scope,id);if(!['cancel','retry'].includes(action))throw fail('Invalid deferred action');
  const row=(await this.pool.query(`UPDATE iaic_deferred_tasks SET state=$5,token=NULL,lease_until=NULL,next_attempt_at=now(),attempts=CASE WHEN $5='retry' THEN 0 ELSE attempts END,updated_at=now()
   WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND id=$4 AND
    (($5='cancelled' AND state IN ('queued','retry','blocked','cancelled') AND admitted_at IS NULL) OR ($5='retry' AND state='blocked')) RETURNING *`,[...identity(scope),id,action==='cancel'?'cancelled':'retry'])).rows[0];
  if(!row)throw fail('Dispatch already admitted or state changed; use the linked Task lifecycle once available',409);return visible(row);
 }
 async claim(){return this.transaction(async c=>{
  const row=(await c.query("SELECT * FROM iaic_deferred_tasks WHERE COALESCE(trigger_not_before,due_at)<=now() AND ((state IN ('queued','retry') AND next_attempt_at<=now()) OR (state='dispatching' AND lease_until<=now())) ORDER BY next_attempt_at,due_at,id FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];if(!row)return null;
  return (await c.query("UPDATE iaic_deferred_tasks SET state='dispatching',token=$2,lease_until=now()+($3::double precision*interval '1 millisecond'),attempts=attempts+1,updated_at=now() WHERE id=$1 RETURNING *",[row.id,randomUUID(),this.leaseMs])).rows[0];
 });}
 async waitForTrigger(row){
  const result=await this.pool.query("UPDATE iaic_deferred_tasks SET state='queued',token=NULL,lease_until=NULL,attempts=GREATEST(attempts-1,0),next_attempt_at=now()+interval '5 seconds',last_error='',updated_at=now() WHERE id=$1 AND token=$2 AND state='dispatching' AND lease_until>now() RETURNING *",[row.id,row.token]);
  if(!result.rowCount)throw fail('Deferred claim is stale',409);return visible(result.rows[0]);
 }
 async admit(row,triggerReceipt=null){const result=await this.pool.query("UPDATE iaic_deferred_tasks SET admitted_at=COALESCE(admitted_at,now()),trigger_receipt=$3,updated_at=now() WHERE id=$1 AND token=$2 AND state='dispatching' AND lease_until>now()",[row.id,row.token,triggerReceipt]);if(!result.rowCount)throw fail('Deferred claim is stale',409);}
 async settle(row,{taskId=null,error='',blocked=false}){
  if(taskId!==null&&!uuid(taskId))throw fail('Valid task receipt required');
  const result=await this.pool.query(`UPDATE iaic_deferred_tasks SET state=CASE WHEN $3::uuid IS NOT NULL THEN 'dispatched' WHEN $5 OR attempts>=$6 THEN 'blocked' ELSE 'retry' END,
   task_id=$3,last_error=$4,token=NULL,lease_until=NULL,next_attempt_at=now()+($7::double precision*interval '1 millisecond'),updated_at=now()
   WHERE id=$1 AND token=$2 AND state='dispatching' AND lease_until>now() RETURNING *`,[row.id,row.token,taskId,String(error).slice(0,2000),blocked,this.maxAttempts,this.retryMs]);
  if(!result.rowCount)throw fail('Deferred claim is stale',409);return visible(result.rows[0]);
 }
}
