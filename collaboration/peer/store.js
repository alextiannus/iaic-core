import fs from 'node:fs/promises';
import {PostgresNotificationStore} from '../../notifications/store.js';
import {fail} from './contracts.js';
export class PostgresPeerStore{
 constructor({pool,namespace}){if(!pool||typeof namespace!=='string'||!namespace||namespace.length>200)throw Error('Peer pool and bounded namespace required');Object.assign(this,{pool,namespace});this.deliveryNamespace='peer:'+namespace;}
 async initialize(){await this.pool.query(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));await new PostgresNotificationStore({pool:this.pool,namespace:this.deliveryNamespace}).initialize();}
 async problems(limit=50){return (await this.pool.query(`SELECT n.id AS "deliveryId",n.scope_id AS "channelId",n.request_key AS "requestKey",n.message->>'id' AS "messageId",n.state,n.created_at AS "createdAt" FROM iaic_notifications n WHERE n.namespace=$1 AND n.state IN ('unknown','failed') AND NOT EXISTS(SELECT 1 FROM iaic_peer_records r WHERE r.namespace=$2 AND r.kind='delivery-escalation' AND r.id=n.id::text) ORDER BY n.created_at,n.id LIMIT $3`,[this.deliveryNamespace,this.namespace,limit])).rows;}
 async transaction(fn){const client=await this.pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['iaic-peer:'+this.namespace]);const n=this.namespace;
 const tx={
  get:async(kind,id,required=true)=>{const row=(await client.query('SELECT data FROM iaic_peer_records WHERE namespace=$1 AND kind=$2 AND id=$3',[n,kind,id])).rows[0]?.data;if(!row&&required)throw fail('PEER_NOT_FOUND','Peer record not found',404);return row??null;},
  put:async(kind,id,data)=>{await client.query('INSERT INTO iaic_peer_records(namespace,kind,id,data) VALUES($1,$2,$3,$4) ON CONFLICT(namespace,kind,id) DO UPDATE SET data=excluded.data',[n,kind,id,data]);return data;},
  list:async(kind,channelId,after=0,limit=100)=>{return (await client.query("SELECT data FROM iaic_peer_records WHERE namespace=$1 AND kind=$2 AND data->>'channelId'=$3 AND COALESCE((data->>'sequence')::bigint,0)>=$4 ORDER BY COALESCE((data->>'sequence')::bigint,0),id LIMIT $5",[n,kind,channelId,after,limit])).rows.map(r=>r.data);},
  audit:async(channelId,kind,actor,data={})=>{await client.query('INSERT INTO iaic_peer_audit(namespace,channel_id,kind,actor,data) VALUES($1,$2,$3,$4,$5)',[n,channelId,kind,actor,data]);},
  history:async(channelId,after,limit)=>(await client.query('SELECT seq,kind,actor,data,created_at FROM iaic_peer_audit WHERE namespace=$1 AND channel_id=$2 AND seq>$3 ORDER BY seq LIMIT $4',[n,channelId,after,limit])).rows,
  outbox:new PostgresNotificationStore({pool:client,namespace:this.deliveryNamespace})
 };const result=await fn(tx);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}
}
