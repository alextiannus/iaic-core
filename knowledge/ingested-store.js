import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {sourceIdValid} from './ingestion.js';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const revision=value=>Number.isSafeInteger(value)&&value>=0&&value<Number.MAX_SAFE_INTEGER;
const state=row=>({sourceId:row.source_id,revision:Number(row.revision),withdrawn:row.withdrawn});
const document=row=>({entry:{...row.metadata,id:row.id,revision:Number(row.revision),source:{...row.metadata.source,ingestionRevision:Number(row.revision),part:row.part,byteStart:row.byte_start,byteEnd:row.byte_end}},text:row.content});
// Independent Catalog adapter. Trusted ingestion owns source writes; catalog readers retain ACL/expiry checks.
export class PostgresIngestedKnowledgeStore{
 constructor({pool,namespace}){if(!pool||!sourceIdValid(namespace))throw fail('Knowledge pool and namespace required');Object.assign(this,{pool,namespace});}
 async initialize(){await this.pool.query(await fs.readFile(new URL('./ingested-schema.sql',import.meta.url),'utf8'));}
 async expired({limit=100}={}){
  if(!Number.isInteger(limit)||limit<1||limit>100)throw fail('Retention limit must be 1–100');
  return (await this.pool.query("SELECT source_id AS id,revision FROM iaic_ingested_knowledge_sources WHERE namespace=$1 AND NOT withdrawn AND (metadata->>'expiresAt')::timestamptz<=statement_timestamp() ORDER BY source_id LIMIT $2",[this.namespace,limit])).rows.map(r=>({id:r.id,revision:Number(r.revision)}));
 }
 async expire({id,revision:expectedRevision}){
  if(!revision(expectedRevision)||expectedRevision<1)throw fail('Current expired source reference required');
  return this.transaction(id,async db=>{
   const result=await db.query("UPDATE iaic_ingested_knowledge_sources SET revision=revision+1,metadata=NULL,digest=NULL,withdrawn=true WHERE namespace=$1 AND source_id=$2 AND revision=$3 AND NOT withdrawn AND (metadata->>'expiresAt')::timestamptz<=statement_timestamp() RETURNING revision",[this.namespace,id,expectedRevision]);
   if(!result.rowCount)throw fail('Knowledge source changed or is no longer expired',409);
   await db.query('DELETE FROM iaic_ingested_knowledge_chunks WHERE namespace=$1 AND source_id=$2',[this.namespace,id]);
   return {id,revision:Number(result.rows[0].revision)};
  });
 }

 async transaction(sourceId,run){
  if(!sourceIdValid(sourceId))throw fail('Valid source ID required');const db=await this.pool.connect();
  try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['knowledge-ingestion',this.namespace,sourceId])]);const result=await run(db);await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}
 }
 async replaceSource({sourceId,expectedRevision,metadata,chunks,digest}){
  if(!revision(expectedRevision)||!metadata||!Array.isArray(chunks)||!chunks.length||chunks.length>1000||!/^[a-f0-9]{64}$/.test(digest||''))throw fail('Validated source snapshot and expected revision required');
  return this.transaction(sourceId,async db=>{
   const prior=(await db.query('SELECT * FROM iaic_ingested_knowledge_sources WHERE namespace=$1 AND source_id=$2',[this.namespace,sourceId])).rows[0];
   if(prior&&!prior.withdrawn&&prior.digest===digest&&[Number(prior.revision),Number(prior.revision)-1].includes(expectedRevision))return {...state(prior),unchanged:true,parts:chunks.length};
   if((prior?Number(prior.revision):0)!==expectedRevision)throw fail('Knowledge source revision changed',409);
   if(prior&&!prior.withdrawn&&prior.metadata.source.sourceRevision===metadata.source.sourceRevision&&prior.metadata.source.contentDigest!==metadata.source.contentDigest)throw fail('Upstream source revision was reused for different content',409);
   await db.query('INSERT INTO iaic_ingested_knowledge_sources(namespace,source_id,revision,metadata,digest) VALUES($1,$2,$3,$4,$5) ON CONFLICT(namespace,source_id) DO UPDATE SET revision=EXCLUDED.revision,metadata=EXCLUDED.metadata,digest=EXCLUDED.digest,withdrawn=false',[this.namespace,sourceId,expectedRevision+1,metadata,digest]);
   await db.query('DELETE FROM iaic_ingested_knowledge_chunks WHERE namespace=$1 AND source_id=$2',[this.namespace,sourceId]);
   const prefix=createHash('sha256').update(sourceId).digest('hex');
   for(const [part,chunk] of chunks.entries())await db.query('INSERT INTO iaic_ingested_knowledge_chunks(namespace,id,source_id,part,content,byte_start,byte_end) VALUES($1,$2,$3,$4,$5,$6,$7)',[this.namespace,prefix+'-'+String(part).padStart(4,'0'),sourceId,part,chunk.text,chunk.byteStart,chunk.byteEnd]);
   return {sourceId,revision:expectedRevision+1,withdrawn:false,unchanged:false,parts:chunks.length};
  });
 }
 async withdrawSource({sourceId,expectedRevision}){
  if(!revision(expectedRevision)||expectedRevision<1)throw fail('Positive source revision required');
  return this.transaction(sourceId,async db=>{
   const changed=await db.query('UPDATE iaic_ingested_knowledge_sources SET revision=revision+1,metadata=NULL,digest=NULL,withdrawn=true WHERE namespace=$1 AND source_id=$2 AND revision=$3 AND NOT withdrawn RETURNING *',[this.namespace,sourceId,expectedRevision]);
   if(!changed.rowCount)throw fail('Knowledge source changed or was withdrawn',409);
   await db.query('DELETE FROM iaic_ingested_knowledge_chunks WHERE namespace=$1 AND source_id=$2',[this.namespace,sourceId]);return state(changed.rows[0]);
  });
 }
 async sourceState(sourceId){if(!sourceIdValid(sourceId))throw fail('Valid source ID required');const row=(await this.pool.query('SELECT source_id,revision,withdrawn FROM iaic_ingested_knowledge_sources WHERE namespace=$1 AND source_id=$2',[this.namespace,sourceId])).rows[0];if(!row)throw fail('Knowledge source not found',404);return state(row);}
 async snapshot(id){if(typeof id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/.test(id))throw fail('Invalid ingested Knowledge ID');const row=(await this.pool.query('SELECT c.*,s.metadata,s.revision FROM iaic_ingested_knowledge_chunks c JOIN iaic_ingested_knowledge_sources s USING(namespace,source_id) WHERE c.namespace=$1 AND c.id=$2 AND NOT s.withdrawn',[this.namespace,id])).rows[0];if(!row)throw fail('Knowledge unavailable',404);return document(row);}
 async describe(id){return (await this.snapshot(id)).entry;}
 async read(id){return (await this.snapshot(id)).text;}
 async list(){return (await this.pool.query('SELECT c.id,c.part,c.byte_start,c.byte_end,s.metadata,s.revision FROM iaic_ingested_knowledge_chunks c JOIN iaic_ingested_knowledge_sources s USING(namespace,source_id) WHERE c.namespace=$1 AND NOT s.withdrawn ORDER BY c.id LIMIT 1001',[this.namespace])).rows.map(row=>document(row).entry);}
}
