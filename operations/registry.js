import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import Ajv from 'ajv';
import {descriptor} from './contracts.js';
const validate=new Ajv({strict:true}).compile(descriptor);
const fail=(message,statusCode=400)=>Object.assign(Error(message),{statusCode});
const text=value=>{if(typeof value!=='string'||!value.trim()||value.length>500)throw fail('Invalid operations identifier');return value;};
/** Trusted Host persistence port. Registration confers NO execution or observation permission. */
export class OperationsRegistry {
 constructor({pool,namespace}){this.pool=pool;this.namespace=text(namespace);}
 async initialize(){await this.pool.query(await readFile(new URL('./registry-schema.sql',import.meta.url),'utf8'));}
 async register(agent){
  if(!validate(agent))throw fail('Invalid Agent registration');
  const row=(await this.pool.query(`INSERT INTO iaic_operations_agents(namespace,id,descriptor) VALUES($1,$2,$3)
   ON CONFLICT(namespace,id) DO UPDATE SET descriptor=EXCLUDED.descriptor,
   revision=iaic_operations_agents.revision+CASE WHEN iaic_operations_agents.descriptor<>EXCLUDED.descriptor THEN 1 ELSE 0 END,
   updated_at=CASE WHEN iaic_operations_agents.descriptor<>EXCLUDED.descriptor THEN clock_timestamp() ELSE iaic_operations_agents.updated_at END
   WHERE iaic_operations_agents.descriptor->>'workspaceId'=EXCLUDED.descriptor->>'workspaceId'
    AND iaic_operations_agents.descriptor->>'principalId'=EXCLUDED.descriptor->>'principalId'
    AND iaic_operations_agents.descriptor->'role'=EXCLUDED.descriptor->'role'
    AND iaic_operations_agents.descriptor->>'location'=EXCLUDED.descriptor->>'location'
    AND iaic_operations_agents.descriptor->'reference'->>'source'=EXCLUDED.descriptor->'reference'->>'source'
    AND iaic_operations_agents.descriptor->'reference'->>'id'=EXCLUDED.descriptor->'reference'->>'id'
   RETURNING descriptor`,[this.namespace,agent.id,agent])).rows[0];
  if(!row)throw fail('Agent registration identity boundary changed',409);
  return row.descriptor;
 }
 async read(id){const row=(await this.pool.query('SELECT descriptor FROM iaic_operations_agents WHERE namespace=$1 AND id=$2',[this.namespace,text(id)])).rows[0];if(!row)throw fail('Agent not registered',404);return row.descriptor;}
 async page({after=null,limit=20,workspaceIds=null}={}){
  if(!Number.isInteger(limit)||limit<1||limit>50||workspaceIds!==null&&(!Array.isArray(workspaceIds)||workspaceIds.length>500))throw fail('Invalid registration page');
  if(after!==null)text(after);if(workspaceIds!==null)workspaceIds.forEach(text);
  const rows=(await this.pool.query(`SELECT id,descriptor FROM iaic_operations_agents WHERE namespace=$1 AND ($2::text IS NULL OR id>$2)
   AND ($3::text[] IS NULL OR descriptor->>'workspaceId'=ANY($3)) ORDER BY id LIMIT $4`,[this.namespace,after,workspaceIds,limit+1])).rows;
  return {items:rows.slice(0,limit).map(r=>r.descriptor),next:rows.length>limit?rows[limit-1].id:null,complete:true};
 }
 /** A new executor generation fences delayed reports from its predecessor. It does not create an Agent. */
 async startExecutor(executorId){
  const generation=randomUUID();
  await this.pool.query(`INSERT INTO iaic_operations_presence(namespace,executor_id,generation) VALUES($1,$2,$3)
   ON CONFLICT(namespace,executor_id) DO UPDATE SET generation=EXCLUDED.generation,sequence=0,observed_at=NULL,valid_until=NULL,state='unknown',reason='not-reported'`,[this.namespace,text(executorId),generation]);
  return generation;
 }
 async heartbeat(executorId,{generation,sequence,ttlMs=15000,state='healthy',basis='observed',reason='executor-loop-responsive'}){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(generation)||!Number.isSafeInteger(sequence)||sequence<1||!Number.isInteger(ttlMs)||ttlMs<1000||ttlMs>60000||!['healthy','degraded','unavailable','unknown'].includes(state)||!['observed','reported'].includes(basis))throw fail('Invalid executor report');
  text(reason);
  const result=await this.pool.query(`UPDATE iaic_operations_presence SET sequence=$4,observed_at=clock_timestamp(),
   valid_until=clock_timestamp()+($5::integer*interval '1 millisecond'),state=$6,reason=$7,basis=$8
   WHERE namespace=$1 AND executor_id=$2 AND generation=$3 AND sequence<$4 RETURNING executor_id`,[this.namespace,text(executorId),generation,sequence,ttlMs,state,reason,basis]);
  if(!result.rowCount)throw fail('Stale executor generation or sequence',409);
 }
 async presence(executorId){
  const row=(await this.pool.query('SELECT * FROM iaic_operations_presence WHERE namespace=$1 AND executor_id=$2',[this.namespace,text(executorId)])).rows[0];
  if(!row?.observed_at)return null;
  return {id:executorId,kind:'executor',state:row.state,basis:row.basis,observedAt:row.observed_at.toISOString(),validUntil:row.valid_until.toISOString(),reason:row.reason,reference:{source:'operations-executor-presence',id:executorId,revision:row.generation+':'+row.sequence}};
 }
}
