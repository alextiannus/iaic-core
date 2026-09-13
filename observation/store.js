import fs from 'node:fs/promises';
import {evidenceDigest,jsonValue} from '../evaluation/runner.js';
import {fail,key} from '../releases/store.js';
export class PostgresObservationStore{
 constructor({pool,namespace}){this.pool=pool;this.namespace=key(namespace);}
 async initialize(){await this.pool.query(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));}
 async record(value){value=jsonValue(value);const digest=evidenceDigest(value);const row=(await this.pool.query('INSERT INTO iaic_observations(namespace,source_id,release_id,observed_at,digest,record) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(namespace,source_id) DO NOTHING RETURNING *',[this.namespace,value.sourceId,value.releaseId,value.observedAt,digest,value])).rows[0]||(await this.pool.query('SELECT * FROM iaic_observations WHERE namespace=$1 AND source_id=$2',[this.namespace,value.sourceId])).rows[0];if(row.digest!==digest)throw fail('Observation source is bound to other evidence',409);return row.record;}
 async window({releaseId,since,until,limit}){const rows=(await this.pool.query('SELECT record,digest FROM iaic_observations WHERE namespace=$1 AND release_id=$2 AND observed_at>=$3 AND observed_at<$4 ORDER BY observed_at,source_id LIMIT $5',[this.namespace,key(releaseId),since,until,limit+1])).rows;for(const r of rows)if(evidenceDigest(r.record)!==r.digest)throw fail('Observation integrity mismatch',409);return {records:rows.slice(0,limit).map(r=>r.record),truncated:rows.length>limit};}
 async putAssessment(record){record=jsonValue(record);const id=evidenceDigest(record);await this.pool.query('INSERT INTO iaic_observation_assessments(namespace,id,record) VALUES($1,$2,$3) ON CONFLICT(namespace,id) DO NOTHING',[this.namespace,id,record]);return {id,...record};}
 async getAssessment(id){const row=(await this.pool.query('SELECT record FROM iaic_observation_assessments WHERE namespace=$1 AND id=$2',[this.namespace,key(id)])).rows[0];if(!row||evidenceDigest(row.record)!==id)throw fail('Assessment unavailable or changed',409);return {id,...row.record};}
}
