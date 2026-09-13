import fs from 'node:fs/promises';
import {evidenceDigest,jsonValue} from '../evaluation/runner.js';
export const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export const key=value=>{if(typeof value!=='string'||!value.trim()||value.length>500)throw fail('Release identifier required');return value;};
const release=row=>{if(!row)return null;if(evidenceDigest(row.record)!==row.digest)throw fail('Release record digest mismatch',409);return {id:row.id,digest:row.digest,record:row.record,disabled:row.disabled};};
const channel=row=>row?{name:row.name,revision:row.revision,stableId:row.stable_id,canaryId:row.canary_id,percentage:row.percentage}:null;
export class PostgresReleaseStore{
 constructor({pool,namespace}){this.pool=pool;this.namespace=key(namespace);}
 async initialize(){await this.pool.query(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));}
 async transaction(action){const db=await this.pool.connect();try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['iaic-release',this.namespace])]);const result=await action(db);await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}}
 async get(id){return release((await this.pool.query('SELECT * FROM iaic_releases WHERE namespace=$1 AND id=$2',[this.namespace,key(id)])).rows[0]);}
 async register(record,actorRef){record=jsonValue(record);const id=key(record.manifest.id),digest=evidenceDigest(record);key(actorRef);return this.transaction(async db=>{
  const prior=release((await db.query('SELECT * FROM iaic_releases WHERE namespace=$1 AND id=$2',[this.namespace,id])).rows[0]);
  if(prior){if(prior.digest!==digest)throw fail('Release ID is already bound to different content',409);return prior;}
  const row=(await db.query('INSERT INTO iaic_releases(namespace,id,digest,record) VALUES($1,$2,$3,$4) RETURNING *',[this.namespace,id,digest,record])).rows[0];
  await db.query('INSERT INTO iaic_release_events(namespace,actor_ref,action,data) VALUES($1,$2,$3,$4)',[this.namespace,actorRef,'register',{id,digest}]);return release(row);
 });}
 async channel(name){return channel((await this.pool.query('SELECT * FROM iaic_release_channels WHERE namespace=$1 AND name=$2',[this.namespace,key(name)])).rows[0]);}
 async setChannel({name,stableId,canaryId=null,percentage=0,expectedRevision},actorRef){
  [name,stableId,actorRef].forEach(key);if(canaryId!==null)key(canaryId);
  if(!Number.isInteger(expectedRevision)||expectedRevision<0||expectedRevision>=2147483647||!Number.isInteger(percentage)||percentage<0||percentage>100||(!canaryId&&percentage!==0)||canaryId===stableId)throw fail('Invalid release channel revision or canary selection');
  return this.transaction(async db=>{
   const current=channel((await db.query('SELECT * FROM iaic_release_channels WHERE namespace=$1 AND name=$2',[this.namespace,name])).rows[0]);if((current?.revision??0)!==expectedRevision)throw fail('Release channel revision changed',409);
   for(const id of [stableId,...(canaryId?[canaryId]:[])]){const candidate=release((await db.query('SELECT * FROM iaic_releases WHERE namespace=$1 AND id=$2',[this.namespace,id])).rows[0]);if(!candidate||candidate.disabled)throw fail('Release target is missing or stopped',409);}
   const row=(await db.query(`INSERT INTO iaic_release_channels(namespace,name,revision,stable_id,canary_id,percentage) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(namespace,name) DO UPDATE SET revision=EXCLUDED.revision,stable_id=EXCLUDED.stable_id,canary_id=EXCLUDED.canary_id,percentage=EXCLUDED.percentage RETURNING *`,[this.namespace,name,expectedRevision+1,stableId,canaryId,percentage])).rows[0];
   const result=channel(row);await db.query('INSERT INTO iaic_release_events(namespace,actor_ref,action,data) VALUES($1,$2,$3,$4)',[this.namespace,actorRef,'channel',{before:current,after:result}]);return result;
  });
 }
 async stop(id,actorRef){key(id);key(actorRef);return this.transaction(async db=>{
  const row=(await db.query('UPDATE iaic_releases SET disabled=true WHERE namespace=$1 AND id=$2 RETURNING *',[this.namespace,id])).rows[0];if(!row)throw fail('Release not found',404);
  await db.query('INSERT INTO iaic_release_events(namespace,actor_ref,action,data) VALUES($1,$2,$3,$4)',[this.namespace,actorRef,'stop',{id}]);return release(row);
 });}
 async rollback({name,expectedRevision,candidateId,manifestDigest,fallbackId,evidence},actorRef){
  [name,candidateId,fallbackId,actorRef].forEach(key);evidence=jsonValue(evidence);
  if(!Number.isInteger(expectedRevision)||expectedRevision<1||expectedRevision>=2147483647||candidateId===fallbackId)throw fail('Invalid rollback binding');
  return this.transaction(async db=>{
   const current=channel((await db.query('SELECT * FROM iaic_release_channels WHERE namespace=$1 AND name=$2',[this.namespace,name])).rows[0]);
   if(!current||current.revision!==expectedRevision||![current.stableId,current.canaryId].includes(candidateId))throw fail('Rollback channel changed or candidate is no longer selected',409);
   const candidate=release((await db.query('SELECT * FROM iaic_releases WHERE namespace=$1 AND id=$2',[this.namespace,candidateId])).rows[0]);
   const fallback=release((await db.query('SELECT * FROM iaic_releases WHERE namespace=$1 AND id=$2',[this.namespace,fallbackId])).rows[0]);
   if(!candidate||candidate.record.manifestDigest!==manifestDigest||!fallback||fallback.disabled)throw fail('Rollback version binding or fallback is unavailable',409);
   await db.query('UPDATE iaic_releases SET disabled=true WHERE namespace=$1 AND id=$2',[this.namespace,candidateId]);
   const after=channel((await db.query('UPDATE iaic_release_channels SET revision=revision+1,stable_id=$3,canary_id=NULL,percentage=0 WHERE namespace=$1 AND name=$2 RETURNING *',[this.namespace,name,fallbackId])).rows[0]);
   await db.query('INSERT INTO iaic_release_events(namespace,actor_ref,action,data) VALUES($1,$2,$3,$4)',[this.namespace,actorRef,'rollback',{before:current,after,stopped:candidateId,manifestDigest,evidence}]);return after;
  });
 }
 async history({after=0,limit=50}={}){if(!Number.isSafeInteger(after)||after<0||!Number.isInteger(limit)||limit<1||limit>100)throw fail('Invalid release history page');return (await this.pool.query('SELECT sequence::text,actor_ref,action,data,created_at FROM iaic_release_events WHERE namespace=$1 AND sequence>$2 ORDER BY sequence LIMIT $3',[this.namespace,after,limit])).rows;}
}
