import fs from 'node:fs/promises';
import {evidenceDigest,jsonValue} from '../evaluation/runner.js';
import {key,fail} from '../releases/store.js';
import {DockerSandbox} from './docker.js';

// Trusted host port. Namespace must identify the owning application/execution host.
export class PostgresExecutionJournal {
 constructor({pool,namespace}) { this.pool=pool; this.namespace=key(namespace); }
 async initialize() { await this.pool.query(await fs.readFile(new URL('./journal.sql',import.meta.url),'utf8')); }
 async started(receipt) {
  receipt=jsonValue(receipt); const id=key(receipt.containerName),digest=evidenceDigest(receipt);
  const r=(await this.pool.query('INSERT INTO iaic_execution_journal(namespace,id,digest,receipt) VALUES($1,$2,$3,$4) ON CONFLICT(namespace,id) DO NOTHING RETURNING digest',[this.namespace,id,digest,receipt])).rows[0];
  if(!r || r.digest!==digest) throw fail('Execution receipt already exists',409);
  return id;
 }
 async get(id) {
  const r=(await this.pool.query('SELECT id,digest,receipt,result FROM iaic_execution_journal WHERE namespace=$1 AND id=$2',[this.namespace,key(id)])).rows[0];
  if(!r) throw fail('Execution receipt unavailable',404);
  if(evidenceDigest(r.receipt)!==r.digest) throw fail('Execution receipt integrity mismatch',409);
  return {id:r.id,receipt:r.receipt,result:r.result};
 }
 async finish(id,result) {
  result=jsonValue(result);
  // Unknown is not a terminal verdict; a later inspection can still recover it.
  await this.pool.query('UPDATE iaic_execution_journal SET result=$3, updated_at=now() WHERE namespace=$1 AND id=$2 AND (result IS NULL OR result->>\'status\'=\'unknown\')',[this.namespace,key(id),result]);
  return this.get(id);
 }
 async pending({limit=100}={}) {
  if(!Number.isInteger(limit)||limit<1||limit>1000)throw fail('Execution page limit must be 1..1000');
  const rows=(await this.pool.query('SELECT id FROM iaic_execution_journal WHERE namespace=$1 AND (result IS NULL OR result->>\'status\'=\'unknown\') ORDER BY updated_at,id LIMIT $2',[this.namespace,limit])).rows;
  return Promise.all(rows.map(r=>this.get(r.id)));
 }
}

export class RecoverableDockerSandbox {
 constructor({journal,...options}) {
  if(!journal)throw fail('Execution journal required');
  if(options.onStart)throw fail('Use the execution journal as the start receipt port');
  this.journal=journal;
  this.sandbox=new DockerSandbox({...options,onStart:receipt=>journal.started({...receipt,startedAt:new Date().toISOString(),timeoutMs:this.sandbox.timeoutMs})});
 }
 async execute(input) {
  const result=await this.sandbox.execute(input);
  if(result.containerName) return (await this.journal.finish(result.containerName,result)).result;
  return result;
 }
 async reconcile(id,{stop=false}={}) {
  const entry=await this.journal.get(id);
  if(entry.result && entry.result.status!=='unknown')return entry;
  const result=await this.sandbox.reconcile(entry.receipt,{stop});
  if(result.status==='running')return {...entry,observation:result};
  return this.journal.finish(id,result);
 }
}
