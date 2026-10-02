import {objectDigest} from './objects.js';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const key=scope=>{if(typeof scope!=='string'||!scope.trim()||scope.length>2000)throw fail('Trusted object scope required');return objectDigest(Buffer.from(scope));};
const valid=ref=>{if(!ref||!/^[a-f0-9]{64}$/.test(ref.sha256)||!Number.isSafeInteger(ref.byteLength)||ref.byteLength<0)throw fail('Invalid object reference');};
// Optional durable adapter. No local disk assumptions; all queries remain scoped.
export class PostgresObjectStore {
 constructor({pool,namespace,maxBytes=4*1024*1024,maxScopeBytes=100*1024*1024}){if(!pool||typeof namespace!=='string'||!namespace.trim()||namespace.length>200||![maxBytes,maxScopeBytes].every(n=>Number.isSafeInteger(n)&&n>0))throw fail('Invalid object store configuration');Object.assign(this,{pool,namespace,maxBytes,maxScopeBytes});}
 async initialize(){await this.pool.query(`CREATE TABLE IF NOT EXISTS iaic_objects(namespace text NOT NULL,scope_id text NOT NULL,sha256 text NOT NULL,bytes bytea NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(namespace,scope_id,sha256))`);}
 async put(scope,bytes){
  if(!(bytes instanceof Uint8Array)||bytes.byteLength>this.maxBytes)throw fail('Object exceeds upload limit',413);
  const data=Buffer.from(bytes),ref={sha256:objectDigest(data),byteLength:data.length},scopeId=key(scope),db=await this.pool.connect();
  try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([this.namespace,scopeId])]);
   const existing=(await db.query('SELECT bytes FROM iaic_objects WHERE namespace=$1 AND scope_id=$2 AND sha256=$3',[this.namespace,scopeId,ref.sha256])).rows[0];
   if(existing){if(!Buffer.from(existing.bytes).equals(data))throw fail('Stored object digest mismatch',409);}
   else {const used=Number((await db.query('SELECT coalesce(sum(octet_length(bytes)),0) AS size FROM iaic_objects WHERE namespace=$1 AND scope_id=$2',[this.namespace,scopeId])).rows[0].size);if(used+data.length>this.maxScopeBytes)throw fail('Personal attachment storage limit reached',413);await db.query('INSERT INTO iaic_objects(namespace,scope_id,sha256,bytes) VALUES($1,$2,$3,$4)',[this.namespace,scopeId,ref.sha256,data]);}
   await db.query('COMMIT');return ref;
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 }
 async get(scope,ref){valid(ref);if(ref.byteLength>this.maxBytes)throw fail('Object exceeds configured limit',413);const row=(await this.pool.query('SELECT bytes FROM iaic_objects WHERE namespace=$1 AND scope_id=$2 AND sha256=$3',[this.namespace,key(scope),ref.sha256])).rows[0];if(!row)throw fail('Object not found',404);const data=Buffer.from(row.bytes);if(data.length!==ref.byteLength||objectDigest(data)!==ref.sha256)throw fail('Object content mismatch',409);return data;}
 async remove(scope,ref){valid(ref);return {removed:(await this.pool.query('DELETE FROM iaic_objects WHERE namespace=$1 AND scope_id=$2 AND sha256=$3',[this.namespace,key(scope),ref.sha256])).rowCount===1};}
}
