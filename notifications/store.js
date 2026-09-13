import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
export const fail = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});
const text = value => {if (typeof value !== 'string' || !value.trim() || value.length > 500) throw fail('Notification identifier required'); return value;};
const document = value => {
  let result;
  try {result = JSON.parse(JSON.stringify(value));} catch {throw fail('Notification documents must be JSON');}
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw fail('Notification documents must be objects');
  return result;
};
const view = row => row ? {id: row.id, scopeId: row.scope_id, requestKey: row.request_key, recipientId: row.recipient_id, channel: row.channel, message: row.message, source: row.source, state: row.state, attempt: row.attempt, result: row.result} : null;
export class PostgresNotificationStore {
  constructor({pool, namespace}) {this.pool = pool; this.namespace = text(namespace);}
  async initialize() {await this.pool.query(await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8'));}
  async enqueue(scopeId, {requestKey, recipientId, channel, message, source = {}}) {
    [scopeId, requestKey, recipientId, channel].forEach(text); message = document(message); source = document(source);
    const values = [this.namespace, scopeId, requestKey, recipientId, channel, message, source];
    const row = (await this.pool.query('INSERT INTO iaic_notifications(namespace,scope_id,request_key,recipient_id,channel,message,source,id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(namespace,scope_id,request_key) DO NOTHING RETURNING *', [...values, randomUUID()])).rows[0]
      || (await this.pool.query('SELECT * FROM iaic_notifications WHERE namespace=$1 AND scope_id=$2 AND request_key=$3', values.slice(0,3))).rows[0];
    if (!row || row.recipient_id !== recipientId || row.channel !== channel || !isDeepStrictEqual(row.message, message) || !isDeepStrictEqual(row.source, source)) throw fail('Notification key is bound to different content', 409);
    return view(row);
  }
  async get(scopeId, requestKey) {return view((await this.pool.query('SELECT * FROM iaic_notifications WHERE namespace=$1 AND scope_id=$2 AND request_key=$3', [this.namespace, text(scopeId), text(requestKey)])).rows[0]);}
  async claim({leaseSeconds = 60} = {}) {
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600) throw fail('Invalid notification lease');
    const attempt = randomUUID();
    return view((await this.pool.query(`WITH chosen AS (
      SELECT id FROM iaic_notifications WHERE namespace=$1 AND state='pending' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
    ), claimed AS (
      UPDATE iaic_notifications SET state='sending',attempt=$2,lease_until=now()+$3*interval '1 second',updated_at=now() WHERE id IN(SELECT id FROM chosen) RETURNING *
    ), recorded AS (
      INSERT INTO iaic_notification_attempts(attempt,notification_id,state) SELECT attempt,id,'sending' FROM claimed
    ) SELECT * FROM claimed`, [this.namespace, attempt, leaseSeconds])).rows[0]);
  }
  async recoverExpired() {
    return (await this.pool.query(`WITH changed AS (
      UPDATE iaic_notifications SET state='unknown',result='{"reason":"worker-lease-expired"}',updated_at=now()
      WHERE namespace=$1 AND state='sending' AND lease_until<=now() RETURNING id,attempt,result
    ), recorded AS (
      UPDATE iaic_notification_attempts SET state='unknown',result=changed.result FROM changed WHERE iaic_notification_attempts.attempt=changed.attempt
    ) SELECT count(*)::integer AS count FROM changed`, [this.namespace])).rows[0].count;
  }
  async canSend(job) {
    return (await this.pool.query("SELECT 1 FROM iaic_notifications WHERE namespace=$1 AND id=$2 AND attempt=$3 AND state='sending' AND lease_until>now()", [this.namespace, job.id, job.attempt])).rowCount === 1;
  }
  async finish(job, result) {
    if (!['delivered','not_sent','unknown'].includes(result?.status)) throw fail('Invalid notification outcome');
    result = document(result);
    const state = result.status === 'not_sent' ? 'failed' : result.status;
    const row = (await this.pool.query(`WITH changed AS (
      UPDATE iaic_notifications SET state=$4,result=$5,lease_until=NULL,updated_at=now()
      WHERE namespace=$1 AND id=$2 AND attempt=$3 AND state IN('sending','unknown') RETURNING *
    ), recorded AS (
      UPDATE iaic_notification_attempts SET state=changed.state,result=changed.result,finished_at=now() FROM changed WHERE iaic_notification_attempts.attempt=changed.attempt
    ) SELECT * FROM changed`, [this.namespace, job.id, job.attempt, state, result])).rows[0];
    if (!row) throw fail('Notification attempt no longer owns this result', 409);
    return view(row);
  }
  async control(scopeId, requestKey, action) {
    if (!['retry','cancel'].includes(action)) throw fail('Unknown notification control');
    const row = (await this.pool.query(`UPDATE iaic_notifications SET state=$4,attempt=NULL,lease_until=NULL,result=NULL,updated_at=now()
      WHERE namespace=$1 AND scope_id=$2 AND request_key=$3 AND ${action === 'retry' ? "state='failed' AND result->>'status'='not_sent'" : "state='pending'"} RETURNING *`,
    [this.namespace, text(scopeId), text(requestKey), action === 'retry' ? 'pending' : 'cancelled'])).rows[0];
    if (!row) throw fail('Only pending notifications can be cancelled; retry requires definitive non-delivery', 409);
    return view(row);
  }
  async history(scopeId, requestKey) {
    return (await this.pool.query(`SELECT a.attempt,a.state,a.result,a.started_at,a.finished_at FROM iaic_notification_attempts a JOIN iaic_notifications n ON n.id=a.notification_id
      WHERE n.namespace=$1 AND n.scope_id=$2 AND n.request_key=$3 ORDER BY a.started_at,a.attempt`, [this.namespace, text(scopeId), text(requestKey)])).rows;
  }
}
