import fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const uuid=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const name=value=>typeof value==='string'&&/^[a-z][a-z0-9_.-]{0,99}$/.test(value);
const scopeValues=scope=>{
 const values=[scope?.applicationId,scope?.assistantId,scope?.subjectId];
 if(values.some(v=>typeof v!=='string'||!v.trim()||v.length>500))throw fail('Trusted Mandate scope required',401);
 return values;
};
const view=row=>({id:row.id,capability:row.capability,tools:row.tools,purpose:row.purpose,expiresAt:row.expires_at,source:row.source,digest:row.digest,grantedAt:row.granted_at,revokedAt:row.revoked_at});
export class MandateStore {
 constructor({pool}){this.pool=pool;}
 async initialize(){await this.pool.query(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));}
 async grant(scope,{requestKey,capability,tools,purpose,expiresAt},source){
  const values=scopeValues(scope);
  if(typeof requestKey!=='string'||!requestKey.trim()||requestKey.length>200||!name(capability)||!Array.isArray(tools)||tools.length<1||tools.length>100||!tools.every(name)||new Set(tools).size!==tools.length||typeof purpose!=='string'||!purpose.trim()||purpose.length>4000||typeof expiresAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(expiresAt)||!Number.isFinite(Date.parse(expiresAt)))throw fail('Mandate requires requestKey, capability, unique tools, purpose and expiry');
  const data={capability,tools:[...tools].sort(),purpose,expiresAt:new Date(expiresAt).toISOString()},digest=createHash('sha256').update(JSON.stringify(data)).digest('hex');
  if(!source||typeof source!=='object'||Array.isArray(source)||Buffer.byteLength(JSON.stringify(source))>4000)throw fail('Trusted Mandate source required');
  await this.pool.query(`INSERT INTO iaic_mandates(id,application_id,assistant_id,subject_id,request_key,capability,tools,purpose,expires_at,source,digest)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(application_id,assistant_id,subject_id,request_key) DO NOTHING`,[randomUUID(),...values,requestKey,data.capability,JSON.stringify(data.tools),data.purpose,data.expiresAt,JSON.stringify(source),digest]);
  // A separate statement observes a concurrent winning insertion after conflict resolution.
  const row=(await this.pool.query('SELECT * FROM iaic_mandates WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND request_key=$4',[...values,requestKey])).rows[0];
  if(row.digest!==digest)throw fail('Mandate request key already belongs to different terms',409);
  return view(row);
 }
 async read(scope,id){
  if(!uuid(id))throw fail('Invalid Mandate ID');
  const row=(await this.pool.query('SELECT * FROM iaic_mandates WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND id=$4',[...scopeValues(scope),id])).rows[0];
  if(!row)throw fail('Mandate not found',404);return view(row);
 }
 async list(scope,{after='',limit=20}={}){
  if(after&&!uuid(after)||!Number.isInteger(limit)||limit<1||limit>50)throw fail('Invalid Mandate page');
  const rows=(await this.pool.query('SELECT * FROM iaic_mandates WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND ($4::uuid IS NULL OR id>$4) ORDER BY id LIMIT $5',[...scopeValues(scope),after||null,limit+1])).rows;
  return {items:rows.slice(0,limit).map(view),next:rows.length>limit?rows[limit-1].id:null};
 }
 async revoke(scope,id){
  if(!uuid(id))throw fail('Invalid Mandate ID');
  const row=(await this.pool.query('UPDATE iaic_mandates SET revoked_at=COALESCE(revoked_at,now()) WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND id=$4 RETURNING *',[...scopeValues(scope),id])).rows[0];
  if(!row)throw fail('Mandate not found',404);return view(row);
 }
}
