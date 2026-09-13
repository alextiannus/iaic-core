import fs from 'node:fs/promises';
import {evidenceDigest,jsonValue} from '../evaluation/runner.js';
import {fail,key} from '../releases/store.js';
const payload=value=>{value=jsonValue(value);if(Buffer.byteLength(JSON.stringify(value))>1000000)throw fail('Monitor cycle payload exceeds limit',413);return value;};
export class PostgresMonitorCycles{
 constructor({pool,namespace}){this.pool=pool;this.namespace=key(namespace);}
 async initialize(){await this.pool.query(await fs.readFile(new URL('./cycles-schema.sql',import.meta.url),'utf8'));}
 async begin(owner,{requestKey,channel}){
  [owner,requestKey,channel].forEach(key);
  const inserted=await this.pool.query("INSERT INTO iaic_monitor_cycles(namespace,owner,request_key,channel,state) VALUES($1,$2,$3,$4,'started') ON CONFLICT DO NOTHING RETURNING request_key",[this.namespace,owner,requestKey,channel]);
  const record=await this.get(owner,requestKey);if(record.channel!==channel)throw fail('Monitor cycle key is bound to another channel',409);return {created:inserted.rowCount===1,record};
 }
 async get(owner,requestKey){
  key(owner);key(requestKey);const row=(await this.pool.query('SELECT * FROM iaic_monitor_cycles WHERE namespace=$1 AND owner=$2 AND request_key=$3',[this.namespace,owner,requestKey])).rows[0];if(!row)throw fail('Monitor cycle not found',404);
  if(row.snapshot&&evidenceDigest(row.snapshot)!==row.snapshot_digest||row.result&&evidenceDigest(row.result)!==row.result_digest)throw fail('Monitor cycle integrity mismatch',409);return row;
 }
 async prepare(owner,requestKey,value){
  value=payload(value);if(typeof value.willProtect!=='boolean')throw fail('Prepared protection decision required');
  const changed=await this.pool.query("UPDATE iaic_monitor_cycles SET state='prepared',snapshot=$4,snapshot_digest=$5 WHERE namespace=$1 AND owner=$2 AND request_key=$3 AND state='started' AND channel=$6 RETURNING request_key",[this.namespace,key(owner),key(requestKey),value,evidenceDigest(value),key(value.channel)]);
  if(!changed.rowCount)throw fail('Monitor cycle already prepared or changed',409);return this.get(owner,requestKey);
 }
 async complete(owner,requestKey,value){
  value=payload(value);const digest=evidenceDigest(value);
  await this.pool.query("UPDATE iaic_monitor_cycles SET state='completed',result=$4,result_digest=$5 WHERE namespace=$1 AND owner=$2 AND request_key=$3 AND state='prepared' AND channel=$6",[this.namespace,key(owner),key(requestKey),value,digest,key(value.channel)]);
  const row=await this.get(owner,requestKey);if(row.state!=='completed'||row.result_digest!==digest)throw fail('Monitor cycle completion differs',409);return row.result;
 }
}
