import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const scopeValues=s=>{const values=[s?.applicationId,s?.assistantId,s?.subjectId];if(!values.every(v=>typeof v==='string'&&v.trim()&&v.length<=500))throw fail('Trusted recurring-task scope required',401);return values;};
const view=r=>({id:r.id,firstAt:new Date(r.first_at).toISOString(),intervalSeconds:r.interval_seconds,occurrenceCount:r.occurrence_count,input:r.input,state:r.state,revision:r.revision,lastSequence:r.last_sequence,pendingSequence:r.pending_sequence,lastIntentId:r.last_intent_id,skippedCount:r.skipped_count,lastError:r.last_error});
export class RecurringTaskStore {
 constructor({pool,leaseMs=60000,retryMs=15000,maxAttempts=3}){if(!Number.isInteger(leaseMs)||leaseMs<1||!Number.isInteger(retryMs)||retryMs<0||!Number.isInteger(maxAttempts)||maxAttempts<1)throw fail('Invalid recurring worker limits');Object.assign(this,{pool,leaseMs,retryMs,maxAttempts});}
 async initialize(){await this.pool.query(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));}
 async transaction(run){const c=await this.pool.connect();try{await c.query('BEGIN');const result=await run(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 async create(scope,{requestKey,firstAt,intervalSeconds,occurrenceCount=null,input}){
  const account=scopeValues(scope);
  if(typeof requestKey!=='string'||!requestKey.trim()||requestKey.length>200||typeof firstAt!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(firstAt)||!Number.isFinite(Date.parse(firstAt))||!Number.isInteger(intervalSeconds)||intervalSeconds<60||intervalSeconds>31536000||(occurrenceCount!==null&&(!Number.isInteger(occurrenceCount)||occurrenceCount<1||occurrenceCount>1000000))||!input||typeof input!=='object'||Array.isArray(input)||Buffer.byteLength(JSON.stringify(input))>24000)throw fail('Explicit first timestamp, interval, bounded count and task input required');
  const first=new Date(firstAt).toISOString();
  return this.transaction(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['recurring',...account,requestKey])]);
   const prior=(await c.query('SELECT * FROM iaic_recurring_tasks WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND request_key=$4',[...account,requestKey])).rows[0];
   if(prior){if(new Date(prior.first_at).toISOString()!==first||prior.interval_seconds!==intervalSeconds||prior.occurrence_count!==occurrenceCount||!isDeepStrictEqual(prior.input,input))throw fail('Recurring key belongs to different input',409);return view(prior);}
   return view((await c.query('INSERT INTO iaic_recurring_tasks(id,application_id,assistant_id,subject_id,request_key,first_at,interval_seconds,occurrence_count,input) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[randomUUID(),...account,requestKey,first,intervalSeconds,occurrenceCount,input])).rows[0]);
  });
 }
 async get(scope,id){if(!uuid(id))throw fail('Invalid recurring task ID');const row=(await this.pool.query('SELECT * FROM iaic_recurring_tasks WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND id=$4',[...scopeValues(scope),id])).rows[0];if(!row)throw fail('Recurring task not found',404);return view(row);}
 async list(scope,{after='',limit=20}={}){if((after&&!uuid(after))||!Number.isInteger(limit)||limit<1||limit>50)throw fail('Invalid recurring page');const rows=(await this.pool.query('SELECT * FROM iaic_recurring_tasks WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND ($4::uuid IS NULL OR id>$4) ORDER BY id LIMIT $5',[...scopeValues(scope),after||null,limit+1])).rows;const items=rows.slice(0,limit).map(view);return {items,nextCursor:rows.length>limit?items.at(-1).id:null};}
 async change(scope,{id,state,expectedRevision}){
  await this.get(scope,id);if(!['active','paused','cancelled'].includes(state)||!Number.isInteger(expectedRevision)||expectedRevision<1)throw fail('Explicit state and revision required');
  const result=await this.pool.query(`UPDATE iaic_recurring_tasks SET state=$5,revision=revision+1,attempts=0,next_attempt_at=now(),last_error=''
   WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND id=$4 AND revision=$6
   AND state NOT IN ('cancelled','completed') AND (token IS NULL OR lease_until<=now())
   AND (pending_sequence IS NULL OR $5='active') RETURNING *`,[...scopeValues(scope),id,state,expectedRevision]);
  if(!result.rowCount)throw fail('Schedule changed or occurrence receipt is unresolved; recover it before pausing/cancelling',409);return view(result.rows[0]);
 }
 async claim(){return this.transaction(async c=>{
  const row=(await c.query(`SELECT *,now() AS observed_at FROM iaic_recurring_tasks WHERE state='active' AND next_attempt_at<=now()
   AND (token IS NULL OR lease_until<=now()) AND (pending_sequence IS NOT NULL OR first_at+(last_sequence::double precision+1)*interval_seconds*interval '1 second'<=now())
   ORDER BY next_attempt_at,first_at,id FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];if(!row)return null;
  const latest=Math.floor((new Date(row.observed_at)-new Date(row.first_at))/(row.interval_seconds*1000));
  const next=row.pending_sequence??Math.min(latest,row.occurrence_count===null?2147483646:row.occurrence_count-1);
  if(next<=row.last_sequence){await c.query("UPDATE iaic_recurring_tasks SET state='completed',revision=revision+1 WHERE id=$1",[row.id]);return null;}
  return (await c.query('UPDATE iaic_recurring_tasks SET pending_sequence=$2,token=$3,lease_until=now()+($4::double precision*interval \'1 millisecond\'),attempts=attempts+1 WHERE id=$1 RETURNING *',[row.id,next,randomUUID(),this.leaseMs])).rows[0];
 });}
 async settle(row,{intentId=null,error=''}){
  if(intentId!==null&&!uuid(intentId))throw fail('Occurrence intent receipt required');
  const result=await this.pool.query(`UPDATE iaic_recurring_tasks SET
   state=CASE WHEN $3::uuid IS NOT NULL AND occurrence_count IS NOT NULL AND pending_sequence=occurrence_count-1 THEN 'completed' WHEN $3::uuid IS NULL AND attempts>=$5 THEN 'blocked' ELSE 'active' END,
   skipped_count=skipped_count+CASE WHEN $3::uuid IS NOT NULL THEN pending_sequence-last_sequence-1 ELSE 0 END,
   last_sequence=CASE WHEN $3::uuid IS NOT NULL THEN pending_sequence ELSE last_sequence END,
   last_intent_id=COALESCE($3,last_intent_id),pending_sequence=CASE WHEN $3::uuid IS NOT NULL THEN NULL ELSE pending_sequence END,
   attempts=CASE WHEN $3::uuid IS NOT NULL THEN 0 ELSE attempts END,token=NULL,lease_until=NULL,revision=revision+1,last_error=$4,
   next_attempt_at=now()+($6::double precision*interval '1 millisecond')
   WHERE id=$1 AND token=$2 AND lease_until>now() AND state='active' RETURNING *`,[row.id,row.token,intentId,String(error).slice(0,2000),this.maxAttempts,intentId?0:this.retryMs]);
  if(!result.rowCount)throw fail('Recurring claim is stale',409);return view(result.rows[0]);
 }
}
