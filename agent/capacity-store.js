import fs from 'node:fs/promises';import {randomUUID} from 'node:crypto';
const fail=(message,statusCode=400,code)=>Object.assign(new Error(message),{statusCode,code});
const key=v=>typeof v==='string'&&v.trim()&&v.length<=200;
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export class PostgresModelCapacity{
 constructor({pool,namespace,maxConcurrent}){if(!pool||!key(namespace)||!Number.isInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>10000)throw fail('Capacity pool, namespace and bounded concurrency required');Object.assign(this,{pool,namespace,maxConcurrent});}
 async initialize(){await this.pool.query(await fs.readFile(new URL('./capacity-schema.sql',import.meta.url),'utf8'));await this.pool.query('INSERT INTO iaic_model_capacity_pools(namespace,capacity) VALUES($1,$2) ON CONFLICT DO NOTHING',[this.namespace,this.maxConcurrent]);await this.checkConfiguration();}
 async checkConfiguration(db=this.pool){const row=(await db.query('SELECT capacity FROM iaic_model_capacity_pools WHERE namespace=$1',[this.namespace])).rows[0];if(row?.capacity!==this.maxConcurrent)throw fail('Capacity namespace has another configuration',409);}
 async admit({taskId,turn}){
  if(!key(taskId)||!Number.isInteger(turn)||turn<1||turn>2147483647)throw fail('Trusted Task turn required');const db=await this.pool.connect();
  try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['model-capacity',this.namespace])]);await this.checkConfiguration(db);
   const existing=(await db.query('SELECT id FROM iaic_model_capacity_reservations WHERE namespace=$1 AND task_id=$2 AND turn=$3',[this.namespace,taskId,turn])).rows[0];if(existing)throw fail('Original Task turn already has a capacity receipt; do not replay',409,'MODEL_TURN_ALREADY_ADMITTED');
   const count=Number((await db.query("SELECT count(*) FROM iaic_model_capacity_reservations WHERE namespace=$1 AND state='active'",[this.namespace])).rows[0].count);
   if(count>=this.maxConcurrent)throw Object.assign(fail('Model concurrency capacity is busy',429,'MODEL_CAPACITY_BUSY'),{providerStatus:429,retryAfterMs:0});
   const row=(await db.query("INSERT INTO iaic_model_capacity_reservations(id,namespace,task_id,turn,state) VALUES($1,$2,$3,$4,'active') RETURNING *",[randomUUID(),this.namespace,taskId,turn])).rows[0];await db.query('COMMIT');return row;
  }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}
 }
 async release(id,evidence){
  if(!uuid(id)||!evidence||typeof evidence!=='object'||Array.isArray(evidence)||Buffer.byteLength(JSON.stringify(evidence))>8000)throw fail('Capacity receipt and bounded terminal evidence required');
  await this.pool.query("UPDATE iaic_model_capacity_reservations SET state='released',evidence=$3,released_at=now() WHERE namespace=$1 AND id=$2 AND state='active'",[this.namespace,id,evidence]);
  return this.get(id);
 }
 async get(id){if(!uuid(id))throw fail('Valid capacity receipt ID required');const row=(await this.pool.query('SELECT * FROM iaic_model_capacity_reservations WHERE namespace=$1 AND id=$2',[this.namespace,id])).rows[0];if(!row)throw fail('Capacity receipt not found',404);return row;}
 async pending({after='',limit=50}={}){if(after&&!uuid(after)||!Number.isInteger(limit)||limit<1||limit>100)throw fail('Bounded capacity page required');const rows=(await this.pool.query("SELECT * FROM iaic_model_capacity_reservations WHERE namespace=$1 AND state='active' AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3",[this.namespace,after||null,limit+1])).rows;return {items:rows.slice(0,limit),nextCursor:rows.length>limit?rows[limit-1].id:null};}
}
