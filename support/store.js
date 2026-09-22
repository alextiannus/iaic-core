import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
export const fail=(code,statusCode=400)=>Object.assign(new Error(code),{code,statusCode});
export function text(v,max=500){if(typeof v!=='string'||!v.trim()||v.length>max)throw fail('SUPPORT_INVALID_TEXT');return v;}
export const transitions=Object.freeze({received:['triaged'],triaged:['fixing'],fixing:['verifying'],verifying:['fixing','resolved'],resolved:['closed','reopened'],closed:['reopened'],reopened:['triaged']});
const view=r=>r?{id:r.id,scopeId:r.scope_id,reporterId:r.reporter_id,report:r.report,state:r.state,revision:r.revision}:null;
export class PostgresSupportStore {
 constructor({pool,namespace}){this.pool=pool;this.namespace=text(namespace);}
 async initialize(){await this.pool.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));}
 async transaction(fn){const c=await this.pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async create(scope,reporter,{requestKey,report}){
  [scope,reporter,requestKey].forEach(v=>text(v));
  return this.transaction(async c=>{
   const args=[this.namespace,scope,reporter,requestKey];
   const inserted=(await c.query('INSERT INTO iaic_support_issues(namespace,scope_id,reporter_id,request_key,id,report) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(namespace,scope_id,reporter_id,request_key) DO NOTHING RETURNING *',[...args,randomUUID(),report])).rows[0];
   const row=inserted??(await c.query('SELECT * FROM iaic_support_issues WHERE namespace=$1 AND scope_id=$2 AND reporter_id=$3 AND request_key=$4',args)).rows[0];
   if(!row||!isDeepStrictEqual(row.report,report))throw fail('SUPPORT_REQUEST_CONFLICT',409);
   if(inserted)await c.query("INSERT INTO iaic_support_events(namespace,scope_id,issue_id,revision,state,actor_id,message) VALUES($1,$2,$3,1,'received',$4,'Received')",[this.namespace,scope,row.id,reporter]);
   return view(row);
  });
 }
 async get(scope,id){return view((await this.pool.query('SELECT * FROM iaic_support_issues WHERE namespace=$1 AND scope_id=$2 AND id=$3',[this.namespace,scope,id])).rows[0]);}
 async list(scope,{reporterId,limit=50}={}){if(!Number.isInteger(limit)||limit<1||limit>100)throw fail('SUPPORT_INVALID_LIMIT');return (await this.pool.query('SELECT * FROM iaic_support_issues WHERE namespace=$1 AND scope_id=$2 AND ($3::text IS NULL OR reporter_id=$3) ORDER BY id LIMIT $4',[this.namespace,scope,reporterId??null,limit])).rows.map(view);}
 async history(scope,id){return (await this.pool.query('SELECT revision,state,message,evidence,created_at AS "createdAt" FROM iaic_support_events WHERE namespace=$1 AND scope_id=$2 AND issue_id=$3 ORDER BY revision',[this.namespace,scope,id])).rows;}
 async change(scope,id,{expectedRevision,state,message,evidence=null,actorId}){
  return this.transaction(async c=>{
   const row=(await c.query('SELECT * FROM iaic_support_issues WHERE namespace=$1 AND scope_id=$2 AND id=$3 FOR UPDATE',[this.namespace,scope,id])).rows[0];
   if(!row)throw fail('SUPPORT_NOT_FOUND',404);
   if(row.revision!==expectedRevision)throw fail('SUPPORT_REVISION_CONFLICT',409);
   if(!transitions[row.state]?.includes(state))throw fail('SUPPORT_TRANSITION_INVALID',409);
   const updated=(await c.query('UPDATE iaic_support_issues SET state=$4,revision=revision+1 WHERE namespace=$1 AND scope_id=$2 AND id=$3 RETURNING *',[this.namespace,scope,id,state])).rows[0];
   await c.query('INSERT INTO iaic_support_events(namespace,scope_id,issue_id,revision,state,actor_id,message,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[this.namespace,scope,id,updated.revision,state,actorId,message,evidence]);
   return view(updated);
  });
 }
}
