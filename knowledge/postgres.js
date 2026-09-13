import fs from 'node:fs/promises';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const idValid=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/.test(value);
const revisionValid=value=>Number.isSafeInteger(value)&&value>=0;
const document=row=>({entry:{...row.metadata,id:row.id,revision:Number(row.revision)},text:row.content});
// Trusted ingestion/storage port. Applications authorize writes and choose a
// catalog namespace; model input must never choose this namespace or policy.
export class PostgresKnowledgeStore{
 constructor({pool,namespace,maxBytes=60000}){if(!pool||!idValid(namespace)||!Number.isSafeInteger(maxBytes)||maxBytes<1)throw fail('Knowledge pool, namespace and positive content limit required');Object.assign(this,{pool,namespace,maxBytes});}
 async initialize(){await this.pool.query(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));}
 async put({id,title,description,source,text,expiresAt=null,policy={},expectedRevision}){
  if(!idValid(id)||typeof title!=='string'||!title.trim()||title.length>300||typeof description!=='string'||description.length>2000||!source||typeof source!=='object'||Array.isArray(source)||typeof source.kind!=='string'||!source.kind.trim()||typeof source.reference!=='string'||!source.reference.trim()||typeof text!=='string'||!revisionValid(expectedRevision)||expectedRevision===Number.MAX_SAFE_INTEGER||!policy||typeof policy!=='object'||Array.isArray(policy))throw fail('Valid sourced knowledge, policy and expectedRevision required');
  if(expiresAt!==null&&(typeof expiresAt!=='string'||!Number.isFinite(Date.parse(expiresAt))))throw fail('Invalid knowledge expiry');
  const metadata={title,description,source,expiresAt:expiresAt===null?null:new Date(expiresAt).toISOString(),policy};
  if(Buffer.byteLength(text)>this.maxBytes||Buffer.byteLength(JSON.stringify(metadata))>16000)throw fail('Knowledge exceeds storage limit',413);
  const result=expectedRevision===0?await this.pool.query('INSERT INTO iaic_knowledge_documents(namespace,id,metadata,content,revision) VALUES($1,$2,$3,$4,1) ON CONFLICT DO NOTHING RETURNING *',[this.namespace,id,metadata,text]):await this.pool.query('UPDATE iaic_knowledge_documents SET metadata=$3,content=$4,revision=revision+1,withdrawn=false,updated_at=now() WHERE namespace=$1 AND id=$2 AND revision=$5 RETURNING *',[this.namespace,id,metadata,text,expectedRevision]);
  if(!result.rows.length)throw fail('Knowledge revision changed; inspect the current revision',409);
  return document(result.rows[0]);
 }
 async withdraw({id,expectedRevision}){
  if(!idValid(id)||!revisionValid(expectedRevision)||expectedRevision<1||expectedRevision===Number.MAX_SAFE_INTEGER)throw fail('Knowledge ID and positive expectedRevision required');
  const result=await this.pool.query("UPDATE iaic_knowledge_documents SET metadata='{}'::jsonb,content=NULL,revision=revision+1,withdrawn=true,updated_at=now() WHERE namespace=$1 AND id=$2 AND revision=$3 AND NOT withdrawn RETURNING id,revision",[this.namespace,id,expectedRevision]);
  if(!result.rows.length)throw fail('Knowledge revision changed or already withdrawn',409);
  return {id:result.rows[0].id,revision:Number(result.rows[0].revision),withdrawn:true};
 }
 async state(id){if(!idValid(id))throw fail('Invalid knowledge ID');const row=(await this.pool.query('SELECT id,revision,withdrawn FROM iaic_knowledge_documents WHERE namespace=$1 AND id=$2',[this.namespace,id])).rows[0];if(!row)throw fail('Knowledge not found',404);return {id:row.id,revision:Number(row.revision),withdrawn:row.withdrawn};}
 async snapshot(id){if(!idValid(id))throw fail('Invalid knowledge ID');const row=(await this.pool.query('SELECT id,metadata,content,revision FROM iaic_knowledge_documents WHERE namespace=$1 AND id=$2 AND NOT withdrawn',[this.namespace,id])).rows[0];if(!row)throw fail('Knowledge not found',404);return document(row);}
 async describe(id){return (await this.snapshot(id)).entry;}
 async read(id){return (await this.snapshot(id)).text;}
 async list(){return (await this.pool.query('SELECT id,metadata,revision FROM iaic_knowledge_documents WHERE namespace=$1 AND NOT withdrawn ORDER BY id LIMIT 1001',[this.namespace])).rows.map(row=>document(row).entry);}
}
