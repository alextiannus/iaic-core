import fs from 'node:fs/promises';import {key,fail} from '../releases/store.js';
import {jsonValue,evidenceDigest} from '../evaluation/runner.js';
export class PostgresDeviceOperations{
 constructor({pool,namespace}){this.pool=pool;this.namespace=key(namespace);}
 async initialize(){await this.pool.query(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));}
 async begin(owner,{deviceId,requestKey,expectedUrl,action}){
  [owner,deviceId,requestKey].forEach(key);const digest=evidenceDigest({deviceId,expectedUrl,action}),db=await this.pool.connect();
  try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['device-operation',this.namespace,deviceId])]);
   const prior=(await db.query('SELECT digest FROM iaic_device_operations WHERE namespace=$1 AND owner=$2 AND request_key=$3',[this.namespace,owner,requestKey])).rows[0];
   let created=false;
   if(prior){if(prior.digest!==digest)throw fail('Device request key is bound to another action',409);}
   else{
    if((await db.query('SELECT 1 FROM iaic_device_operations WHERE namespace=$1 AND device_id=$2 AND result IS NULL LIMIT 1',[this.namespace,deviceId])).rowCount)throw fail('Device has an unresolved action',409);
    await db.query('INSERT INTO iaic_device_operations(namespace,owner,request_key,device_id,digest,action_type) VALUES($1,$2,$3,$4,$5,$6)',[this.namespace,owner,requestKey,deviceId,digest,action.type]);created=true;
   }
   await db.query('COMMIT');return {created,receipt:await this.get(owner,requestKey)};
  }catch(error){await db.query('ROLLBACK').catch(()=>{});if(error.code==='23505')throw fail('Device request key is bound to another action',409);throw error;}finally{db.release();}
 }
 async get(owner,requestKey){const row=(await this.pool.query('SELECT device_id AS "deviceId",request_key AS "requestKey",digest,action_type AS "actionType",result FROM iaic_device_operations WHERE namespace=$1 AND owner=$2 AND request_key=$3',[this.namespace,key(owner),key(requestKey)])).rows[0];if(!row)throw fail('Device receipt not found',404);return row;}
 async complete(owner,requestKey,result){result=jsonValue(result);await this.pool.query('UPDATE iaic_device_operations SET result=$4 WHERE namespace=$1 AND owner=$2 AND request_key=$3 AND result IS NULL',[this.namespace,key(owner),key(requestKey),result]);const row=await this.get(owner,requestKey);if(evidenceDigest(row.result)!==evidenceDigest(result))throw fail('Device terminal receipt differs',409);return row;}
}
