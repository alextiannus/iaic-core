import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const validId=id=>{if(typeof id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw fail('Invalid handoff ID',400);};
export const fail=(message,statusCode=409)=>Object.assign(new Error(message),{statusCode});
const scopeValues=scope=>{const values=[scope?.applicationId,scope?.subjectId];if(values.some(v=>typeof v!=='string'||!v.trim()||v.length>500))throw fail('Trusted handoff scope required',401);return values;};
export class HandoffStore {
 constructor({pool}){this.pool=pool;}
 async initialize(){await this.pool.query(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));}
 async create(scope,{requestKey,terms,input}){
  const c=await this.pool.connect();
  try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([...scopeValues(scope),requestKey])]);
   const prior=(await c.query('SELECT *, terms=$4::jsonb AS same_terms FROM iaic_handoffs WHERE application_id=$1 AND subject_id=$2 AND request_key=$3',[...scopeValues(scope),requestKey,JSON.stringify(terms)])).rows[0];
   if(prior){if(!prior.same_terms)throw fail('Handoff key belongs to different terms');delete prior.same_terms;await c.query('COMMIT');return prior;}
   const row=(await c.query('INSERT INTO iaic_handoffs(id,application_id,subject_id,request_key,parent_task_id,terms,input) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[randomUUID(),...scopeValues(scope),requestKey,terms.parentTaskId,JSON.stringify(terms),JSON.stringify(input)])).rows[0];await c.query('COMMIT');return row;
  }catch(e){await c.query('ROLLBACK').catch(()=>{});if(e.code==='23505')throw fail('Parent already has an open handoff');throw e;}finally{c.release();}
 }
 async find(scope,requestKey){return (await this.pool.query('SELECT * FROM iaic_handoffs WHERE application_id=$1 AND subject_id=$2 AND request_key=$3',[...scopeValues(scope),requestKey])).rows[0]||null;}
 async get(scope,id){validId(id);const row=(await this.pool.query('SELECT * FROM iaic_handoffs WHERE application_id=$1 AND subject_id=$2 AND id=$3',[...scopeValues(scope),id])).rows[0];if(!row)throw fail('Handoff not found',404);return row;}
 async forParent(scope,id){return (await this.pool.query("SELECT * FROM iaic_handoffs WHERE application_id=$1 AND subject_id=$2 AND parent_task_id=$3 AND state IN ('prepared','active')",[...scopeValues(scope),id])).rows[0]||null;}
 async historyForParent(scope,id,{limit=11}={}){validId(id);if(!Number.isInteger(limit)||limit<1||limit>21)throw fail('Invalid handoff context limit',400);return (await this.pool.query('SELECT * FROM iaic_handoffs WHERE application_id=$1 AND subject_id=$2 AND parent_task_id=$3 ORDER BY created_at DESC,id DESC LIMIT $4',[...scopeValues(scope),id,limit])).rows;}
 async list(scope){return (await this.pool.query('SELECT * FROM iaic_handoffs WHERE application_id=$1 AND subject_id=$2 ORDER BY created_at DESC LIMIT 50',scopeValues(scope))).rows;}
 async open(){return (await this.pool.query("SELECT * FROM iaic_handoffs WHERE state IN ('prepared','active') OR (state IN ('cancelled','expired') AND reconciled_at IS NULL) ORDER BY created_at")).rows;}
 async activate(scope,id){return (await this.pool.query("UPDATE iaic_handoffs SET state='active',admitted_at=COALESCE(admitted_at,now()),updated_at=now() WHERE application_id=$1 AND subject_id=$2 AND id=$3 AND state IN ('prepared','active') RETURNING *",[...scopeValues(scope),id])).rows[0]||await this.get(scope,id);}
 async attach(scope,id,taskId){const row=(await this.pool.query('UPDATE iaic_handoffs SET child_task_id=$4,updated_at=now() WHERE application_id=$1 AND subject_id=$2 AND id=$3 AND (child_task_id IS NULL OR child_task_id=$4) RETURNING *',[...scopeValues(scope),id,taskId])).rows[0];if(!row)throw fail('Handoff receipt changed');return row;}
 async close(scope,id,state){validId(id);if(!['cancelled','expired','finished'].includes(state))throw fail('Invalid handoff outcome',400);return (await this.pool.query("UPDATE iaic_handoffs SET state=$4,updated_at=now() WHERE application_id=$1 AND subject_id=$2 AND id=$3 AND state IN ('prepared','active') RETURNING *",[...scopeValues(scope),id,state])).rows[0]||await this.get(scope,id);}
 async reconciled(scope,id){await this.pool.query('UPDATE iaic_handoffs SET reconciled_at=COALESCE(reconciled_at,now()) WHERE application_id=$1 AND subject_id=$2 AND id=$3',[...scopeValues(scope),id]);}
 async used(id){return (await this.pool.query('SELECT count(*)::int AS n FROM iaic_handoff_model_calls WHERE handoff_id=$1',[id])).rows[0].n;}
 async admitModel(scope,id,taskId,turn){
  const c=await this.pool.connect();
  try{await c.query('BEGIN');const row=(await c.query('SELECT * FROM iaic_handoffs WHERE application_id=$1 AND subject_id=$2 AND id=$3 FOR UPDATE',[...scopeValues(scope),id])).rows[0];
   if(!row||row.state!=='active'||row.child_task_id!==taskId||Date.parse(row.terms.deadlineAt)<=Date.now())throw fail('Handoff is no longer executable');
   if(!Number.isInteger(turn)||turn<1)throw fail('Trusted model turn required',400);
   const prior=await c.query('SELECT 1 FROM iaic_handoff_model_calls WHERE handoff_id=$1 AND task_id=$2 AND turn=$3',[id,taskId,turn]);
   if(prior.rowCount)throw fail('Handoff model turn was already admitted; reconcile rather than replay');
   const used=(await c.query('SELECT count(*)::int AS n FROM iaic_handoff_model_calls WHERE handoff_id=$1',[id])).rows[0].n;
   if(used>=row.terms.maxModelCalls)throw fail('Handoff model-call budget exhausted');
   await c.query('INSERT INTO iaic_handoff_model_calls(handoff_id,task_id,turn) VALUES($1,$2,$3)',[id,taskId,turn]);await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
 }
}
