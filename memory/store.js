import {memoryImportSnapshot} from './import-format.js';
import fs from 'node:fs/promises';
const error=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const identifier=value=>typeof value==='string'&&value.trim().length>0&&value.length<=200;
function partition(scope){
 const values=[scope?.applicationId,scope?.assistantId,scope?.subjectId];
 if(!values.every(identifier))throw error('Trusted memory scope required',401);return values;
}
function version(value){if(!Number.isSafeInteger(value)||value<0)throw error('Memory revision required');}
// The application supplies authenticated scope. Model input never chooses it.
export class MemoryStore{
 constructor({pool}){this.pool=pool;}
 async initialize(){await this.pool.query(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));}
 async remember(scope,input){return this.#write(scope,input,'remember');}
 async relearn(scope,input){version(input.expectedRevision);if(input.expectedRevision<1)throw error('Current forgotten memory revision required');return this.#write(scope,input,'relearn');}
 async resolveDispute(scope,input){version(input.expectedRevision);if(input.expectedRevision<1)throw error('Current disputed memory revision required');return this.#write(scope,input,'resolve');}
 async dispute(scope,{key,reason,expectedRevision,source}){
  version(expectedRevision);if(!identifier(key)||expectedRevision<1||typeof reason!=='string'||!reason.trim()||reason.length>2000)throw error('Memory dispute requires key, reason and current revision');
  if(!source||typeof source!=='object'||Array.isArray(source)||typeof source.kind!=='string'||!source.kind.trim()||Buffer.byteLength(JSON.stringify(source))>4000)throw error('Memory source required');
  const result=await this.pool.query(`UPDATE iaic_memories SET dispute=$6,revision=revision+1,updated_at=now()
   WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND memory_key=$4 AND revision=$5 AND NOT deleted AND dispute IS NULL AND (expires_at IS NULL OR expires_at>statement_timestamp()) RETURNING memory_key,revision`,[...partition(scope),key,expectedRevision,{reason,source}]);
  if(!result.rowCount)throw error('Memory changed or is not active',409);return result.rows[0];
 }
 async #write(scope,{key,kind,content,source,expectedRevision=0,expiresAt=null},mode){
  const identity=partition(scope);version(expectedRevision);
  if(!identifier(key)||!['fact','preference','note'].includes(kind)||typeof content!=='string'||!content.trim()||content.length>8000)throw error('Invalid memory');
  if(!source||typeof source!=='object'||Array.isArray(source)||typeof source.kind!=='string'||!source.kind.trim()||Buffer.byteLength(JSON.stringify(source))>4000)throw error('Memory source required');
  if(expiresAt!==null&&(typeof expiresAt!=='string'||!Number.isFinite(Date.parse(expiresAt))))throw error('Invalid memory expiration');
  const values=[...identity,key,kind,content,JSON.stringify(source),expiresAt,expectedRevision,mode==='relearn',mode==='resolve'];
  // Revision zero is create-only. A tombstone retains the revision so an old
  // request cannot resurrect forgotten content or overwrite a replacement.
  const result=expectedRevision===0?
   await this.pool.query(`INSERT INTO iaic_memories(application_id,assistant_id,subject_id,memory_key,kind,content,source,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING *`,values.slice(0,8)):
   await this.pool.query(`UPDATE iaic_memories SET kind=$5,content=$6,source=$7,expires_at=$8,revision=revision+1,deleted=false,dispute=NULL,updated_at=now()
    WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND memory_key=$4 AND revision=$9 AND deleted=$10 AND (($11::boolean AND dispute IS NOT NULL) OR (NOT $11::boolean AND dispute IS NULL)) RETURNING *`,values);
  if(!result.rowCount)throw error('Memory changed or is unavailable; read current state before updating',409);
  return result.rows[0];
 }
 async read(scope,{key}){
  if(!identifier(key))throw error('Memory key required');
  const active="NOT deleted AND (expires_at IS NULL OR expires_at>statement_timestamp())";
  const row=(await this.pool.query(`SELECT memory_key AS key,revision,kind,dispute IS NOT NULL AS disputed,
   CASE WHEN deleted THEN 'forgotten' WHEN expires_at<=statement_timestamp() THEN 'expired' WHEN dispute IS NOT NULL THEN 'disputed' ELSE 'active' END AS status,
   CASE WHEN ${active} THEN content ELSE NULL END AS content,
   CASE WHEN ${active} THEN source ELSE NULL END AS source,CASE WHEN ${active} THEN dispute ELSE NULL END AS dispute,expires_at AS "expiresAt",updated_at AS "updatedAt"
   FROM iaic_memories WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND memory_key=$4`,[...partition(scope),key])).rows[0];
  if(!row)throw error('Memory not found',404);return row;
 }
 async list(scope,{query='',limit=20,kind=null,status='active'}={}){
  const identity=partition(scope);
  if(!['active','disputed'].includes(status)||typeof query!=='string'||query.length>500||!Number.isInteger(limit)||limit<1||limit>50||(kind!==null&&!['fact','preference','note'].includes(kind)))throw error('Invalid memory lookup');
  const pattern='%'+query.replace(/[\\%_]/g,'\\$&')+'%';
  return (await this.pool.query(`SELECT * FROM iaic_memories WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3
   AND NOT deleted AND (($7='active' AND dispute IS NULL) OR ($7='disputed' AND dispute IS NOT NULL)) AND (expires_at IS NULL OR expires_at>now()) AND content ILIKE $4
   AND ($5::text IS NULL OR kind=$5) ORDER BY updated_at DESC,memory_key ASC LIMIT $6`,[...identity,pattern,kind,limit,status])).rows;
 }
 async export(scope){
  const {rows:[snapshot]}=await this.pool.query(`WITH visible AS (
   SELECT memory_key,kind,content,source,revision,expires_at,created_at,updated_at FROM iaic_memories
   WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND NOT deleted AND dispute IS NULL AND (expires_at IS NULL OR expires_at>now())
   ORDER BY memory_key LIMIT 1001
  ) SELECT statement_timestamp() AS exported_at,COALESCE(jsonb_agg(to_jsonb(visible) ORDER BY memory_key),'[]'::jsonb) AS memories FROM visible`,partition(scope));
  if(snapshot.memories.length>1000||Buffer.byteLength(JSON.stringify(snapshot.memories))>8_000_000)throw error('Memory export exceeds synchronous snapshot limit; no partial export returned',413);
  return {format:'iaic.memory.export.v1',exportedAt:snapshot.exported_at,memories:snapshot.memories};
 }
 async import(scope,{requestKey,snapshot,source}){
  const identity=partition(scope);if(!identifier(requestKey))throw error('Stable import requestKey required');
  if(!source||typeof source!=='object'||Array.isArray(source)||typeof source.kind!=='string'||!source.kind.trim())throw error('Trusted import source required');
  const batch=memoryImportSnapshot(snapshot),client=await this.pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['memory-import',...identity,requestKey])]);
   const prior=(await client.query('SELECT request_digest,receipt FROM iaic_memory_imports WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND request_key=$4',[...identity,requestKey])).rows[0];
   if(prior){if(prior.request_digest!==batch.digest)throw error('Import request key belongs to a different snapshot',409);await client.query('COMMIT');return prior.receipt;}
   const at=(await client.query('SELECT transaction_timestamp() AS at')).rows[0].at;
   const receipt={format:'iaic.memory.import.v1',requestKey,importedAt:new Date(at).toISOString(),imported:[],skippedExpired:[]};
   const writer=new MemoryStore({pool:client});
   for(const item of batch.records){
    if(item.expiresAt!==null&&new Date(item.expiresAt)<=at){receipt.skippedExpired.push(item.key);continue;}
    const saved=await writer.remember(scope,{key:item.key,kind:item.kind,content:item.content,expiresAt:item.expiresAt,expectedRevision:0,source:{kind:'user-import',importedBy:source,exportedAt:batch.exportedAt,claimedSource:item.claimedSource,originalRevision:item.originalRevision}});
    receipt.imported.push({key:saved.memory_key,revision:saved.revision});
   }
   // Retain only a digest and content-free receipt. Replay after forgetting
   // returns the original import receipt and never recreates a memory.
   await client.query('INSERT INTO iaic_memory_imports(application_id,assistant_id,subject_id,request_key,request_digest,receipt) VALUES($1,$2,$3,$4,$5,$6)',[...identity,requestKey,batch.digest,receipt]);
   await client.query('COMMIT');return receipt;
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 }
 async forget(scope,{key,expectedRevision}){
  const identity=partition(scope);version(expectedRevision);if(!identifier(key)||expectedRevision===0)throw error('Current memory key and revision required');
  const result=await this.pool.query(`UPDATE iaic_memories SET content=NULL,source=NULL,dispute=NULL,deleted=true,revision=revision+1,updated_at=now()
   WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND memory_key=$4 AND revision=$5 AND NOT deleted RETURNING memory_key,revision,deleted`,[...identity,key,expectedRevision]);
  if(!result.rowCount)throw error('Memory changed or is unavailable',409);return result.rows[0];
 }
}
