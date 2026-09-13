import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const error=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const identifier=value=>typeof value==='string'&&value.trim()&&value.length<=200&&!value.includes('\0');
function identity(scope){
 const values=[scope?.applicationId,scope?.assistantId,scope?.subjectId];
 if(!values.every(identifier))throw error('Trusted workspace scope required',401);return values;
}
function logicalPath(value){
 if(typeof value!=='string'||!value||value.length>300||/[\x00-\x1f\x7f\\]/.test(value)||value.split('/').some(part=>!part||part==='.'||part==='..'))throw error('Invalid workspace path');
 return value;
}
function revision(value,minimum=0){if(!Number.isSafeInteger(value)||value<minimum||value>2147483646)throw error('Valid workspace revision required');return value;}
function artifact(row,{includeContent=false}={}){
 const value={reference:{path:row.path,revision:row.revision,digest:row.digest},mediaType:row.media_type,bytes:row.bytes,source:row.source,createdAt:row.created_at};
 if(includeContent)value.content=row.content;return value;
}
// A small-document PostgreSQL adapter. Workspace's service contract permits
// other stores; applications need not store large files in PostgreSQL.
export class PostgresWorkspaceStore{
 constructor({pool,maxBytes=256000}){this.pool=pool;this.maxBytes=maxBytes;}
 async initialize(){await this.pool.query(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));}
 async transaction(scope,path,operation){
  const key=[...identity(scope),logicalPath(path)],client=await this.pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['workspace',...key])]);
   const head=(await client.query('SELECT * FROM iaic_workspace_heads WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND path=$4 FOR UPDATE',key)).rows[0];
   const result=await operation(client,key,head);await client.query('COMMIT');return result;
  }catch(cause){await client.query('ROLLBACK').catch(()=>{});throw cause;}finally{client.release();}
 }
 async write(scope,{path,content,mediaType='text/plain',source,expectedRevision=0}){
  revision(expectedRevision);
  if(typeof content!=='string'||content.includes('\0')||!['text/plain','text/markdown','application/json'].includes(mediaType))throw error('Workspace accepts UTF-8 text documents');
  if(Buffer.byteLength(content)>this.maxBytes)throw error('Workspace document exceeds adapter size limit',413);
  if(mediaType==='application/json'){try{JSON.parse(content);}catch{throw error('Invalid JSON document');}}
  if(!source||typeof source!=='object'||Array.isArray(source)||!identifier(source.kind)||Buffer.byteLength(JSON.stringify(source))>4000)throw error('Workspace source required');
  const digest=createHash('sha256').update(content).digest('hex');
  return this.transaction(scope,path,async(client,key,head)=>{
   if(head?.deleted||(head?.revision??0)!==expectedRevision)throw error('Workspace changed or is unavailable; read before writing',409);
   const next=expectedRevision+1;
   if(!head)await client.query('INSERT INTO iaic_workspace_heads(application_id,assistant_id,subject_id,path,revision) VALUES($1,$2,$3,$4,$5)',[...key,next]);
   else await client.query('UPDATE iaic_workspace_heads SET revision=$5 WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND path=$4',[...key,next]);
   const row=(await client.query(`INSERT INTO iaic_workspace_versions(application_id,assistant_id,subject_id,path,revision,content,media_type,digest,source)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *,octet_length(content) AS bytes`,[...key,next,content,mediaType,digest,JSON.stringify(source)])).rows[0];
   return artifact(row);
  });
 }
 async read(scope,{path,revision:requested=null,digest=null}){
  if(requested!==null)revision(requested,1);
  if(digest!==null&&(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest)))throw error('Invalid artifact digest');
  const row=(await this.pool.query(`SELECT v.*,octet_length(v.content) AS bytes FROM iaic_workspace_heads h JOIN iaic_workspace_versions v
   USING(application_id,assistant_id,subject_id,path)
   WHERE h.application_id=$1 AND h.assistant_id=$2 AND h.subject_id=$3 AND h.path=$4 AND NOT h.deleted AND v.revision=COALESCE($5,h.revision)`,[...identity(scope),logicalPath(path),requested])).rows[0];
  if(!row)throw error('Workspace document not found',404);
  if(digest!==null&&digest!==row.digest)throw error('Artifact reference does not match its content',409);
  return artifact(row,{includeContent:true});
 }
 async list(scope,{after='',limit=20}={}){
  if(after!=='')logicalPath(after);if(!Number.isInteger(limit)||limit<1||limit>50)throw error('Invalid workspace page size');
  const rows=(await this.pool.query(`SELECT v.path,v.revision,v.media_type,v.digest,v.source,v.created_at,octet_length(v.content) AS bytes
   FROM iaic_workspace_heads h JOIN iaic_workspace_versions v USING(application_id,assistant_id,subject_id,path,revision)
   WHERE h.application_id=$1 AND h.assistant_id=$2 AND h.subject_id=$3 AND NOT h.deleted AND h.path>$4
   ORDER BY h.path LIMIT $5`,[...identity(scope),after,limit+1])).rows;
  const more=rows.length>limit,items=rows.slice(0,limit).map(row=>artifact(row));return {items,nextCursor:more?items.at(-1).reference.path:null};
 }
 async remove(scope,{path,expectedRevision}){
  revision(expectedRevision,1);
  return this.transaction(scope,path,async(client,key,head)=>{
   if(!head||head.deleted||head.revision!==expectedRevision)throw error('Workspace changed or is unavailable',409);
   // Delete all revisions, not only the current view. References stop resolving.
   await client.query('DELETE FROM iaic_workspace_versions WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND path=$4',key);
   await client.query('UPDATE iaic_workspace_heads SET deleted=true,revision=revision+1 WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND path=$4',key);
   return {path,revision:expectedRevision+1,deleted:true};
  });
 }
}
