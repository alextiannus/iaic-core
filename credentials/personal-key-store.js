import fs from 'node:fs/promises';
import {identifier} from '../accounts/store.js';
const record = row => row ? {id:row.id, accountId:row.account_id, organizationId:row.organization_id,
 label:row.label, capabilities:row.capabilities, digest:row.digest, requestKey:row.request_key,
 createdAt:new Date(row.created_at).toISOString(), expiresAt:new Date(row.expires_at).toISOString(),
 revokedAt:row.revoked_at ? new Date(row.revoked_at).toISOString() : null} : null;
// Trusted persistence port; never expose directly to clients.
export class PostgresPersonalKeyStore {
 constructor({pool,namespace}) { this.pool=pool; this.namespace=identifier(namespace); }
 async initialize() { await this.pool.query(await fs.readFile(new URL('./personal-keys.sql',import.meta.url),'utf8')); }
 async get(id) { return record((await this.pool.query('SELECT * FROM iaic_personal_keys WHERE namespace=$1 AND id=$2',[this.namespace,id])).rows[0]); }
 async insert(value,replaceId=null) {
  const client=await this.pool.connect();
  try {
   await client.query('BEGIN');
   if(replaceId) {
    const old=(await client.query('UPDATE iaic_personal_keys SET revoked_at=$5 WHERE namespace=$1 AND id=$2 AND account_id=$3 AND organization_id IS NOT DISTINCT FROM $4 AND revoked_at IS NULL RETURNING id',[this.namespace,replaceId,value.accountId,value.organizationId,value.createdAt])).rows[0];
    if(!old) throw Object.assign(new Error('Credential replacement conflict'),{statusCode:409});
   }
   await client.query('INSERT INTO iaic_personal_keys(namespace,id,account_id,organization_id,label,capabilities,digest,request_key,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)',[this.namespace,value.id,value.accountId,value.organizationId,value.label,JSON.stringify(value.capabilities),value.digest,value.requestKey,value.createdAt,value.expiresAt]);
   await client.query('COMMIT');
  } catch(error) { await client.query('ROLLBACK'); if(error.code==='23505')throw Object.assign(new Error('Credential request already recorded; list and revoke if the secret was lost'),{statusCode:409}); throw error; }
  finally { client.release(); }
 }
 async list(accountId,{after='',limit=50}={}) {
  return (await this.pool.query('SELECT * FROM iaic_personal_keys WHERE namespace=$1 AND account_id=$2 AND id::text>$3 ORDER BY id::text LIMIT $4',[this.namespace,accountId,after,limit])).rows.map(record);
 }
 async revoke(accountId,id,at) { return record((await this.pool.query('UPDATE iaic_personal_keys SET revoked_at=COALESCE(revoked_at,$4) WHERE namespace=$1 AND account_id=$2 AND id=$3 RETURNING *',[this.namespace,accountId,id,at])).rows[0]); }
}
