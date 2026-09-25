import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
export const fail = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});
export const text = value => {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw fail('Inbox text required (maximum 2000 characters)');
  return value;
};
const uuid = value => {if (typeof value !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw fail('Invalid Inbox ID'); return value;};
const stamp = value => value ? new Date(value).toISOString() : null;
const item = row => row ? {id: row.id, scopeId: row.scope_id, sequence: String(row.sequence), requestKey: row.request_key,
  ...row.document, createdAt: stamp(row.created_at), deliveredAt: stamp(row.delivered_at), readAt: stamp(row.read_at), archivedAt: stamp(row.archived_at), version: row.version} : null;
const projection = row => row ? {id: row.id, scopeId: row.scope_id, itemId: row.item_id, kind: row.kind, requestKey: row.request_key,
  state: row.state, attempt: row.attempt, result: row.result} : null;
export class PostgresInboxStore {
  constructor({pool, namespace}) {this.pool = pool; this.namespace = text(namespace);}
  async initialize() {await this.pool.query(await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8'));}
  async receive(scopeId, input) {
    const {requestKey, notificationId, title, summary, category, priority, relatedObjectRef = null, actionRef = null} = input;
    [scopeId, requestKey, notificationId, title, summary, category, priority].forEach(text);
    if (relatedObjectRef !== null) text(relatedObjectRef);
    if (actionRef !== null) text(actionRef);
    const document = {notificationId, title, summary, category, priority, relatedObjectRef, actionRef};
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize insertion in one scope so a committed page cursor never skips a late-committing older sequence.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([this.namespace, scopeId])]);
      const args = [this.namespace, scopeId, requestKey];
      const row = (await client.query('INSERT INTO iaic_inbox(id,namespace,scope_id,request_key,document) VALUES($4,$1,$2,$3,$5) ON CONFLICT(namespace,scope_id,request_key) DO NOTHING RETURNING *', [...args, randomUUID(), document])).rows[0]
        || (await client.query('SELECT * FROM iaic_inbox WHERE namespace=$1 AND scope_id=$2 AND request_key=$3', args)).rows[0];
      if (!isDeepStrictEqual(row.document, document)) throw fail('Inbox key is bound to different content', 409);
      await client.query('COMMIT'); return item(row);
    } catch (error) {await client.query('ROLLBACK'); throw error;} finally {client.release();}
  }
  async get(scopeId, id) {return item((await this.pool.query('SELECT * FROM iaic_inbox WHERE namespace=$1 AND scope_id=$2 AND id=$3', [this.namespace, text(scopeId), uuid(id)])).rows[0]);}
  async list(scopeId, {before, limit = 20, archived = false} = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || typeof archived !== 'boolean' || (before !== undefined && !/^[1-9][0-9]{0,17}$/.test(before))) throw fail('Invalid Inbox page');
    // Page and total unread count share one PostgreSQL statement snapshot.
    const row = (await this.pool.query(`SELECT
      (SELECT count(*)::integer FROM iaic_inbox WHERE namespace=$1 AND scope_id=$2 AND read_at IS NULL AND archived_at IS NULL) AS unread,
      COALESCE((SELECT jsonb_agg(to_jsonb(p) || jsonb_build_object('sequence',p.sequence::text) ORDER BY p.sequence DESC) FROM (SELECT * FROM iaic_inbox WHERE namespace=$1 AND scope_id=$2
        AND (archived_at IS NOT NULL)=$5 AND ($3::bigint IS NULL OR sequence<$3) ORDER BY sequence DESC LIMIT $4) p),'[]') AS items`,
      [this.namespace, text(scopeId), before ?? null, limit + 1, archived])).rows[0];
    const page = row.items.slice(0, limit).map(item);
    return {items: page, unreadCount: row.unread, next: row.items.length > limit ? page.at(-1).sequence : null};
  }
  async mark(scopeId, id, action) {
    const assignments = {read: 'read_at=COALESCE(read_at,now())', unread: 'read_at=NULL', archive: 'archived_at=COALESCE(archived_at,now())'};
    if (!assignments[action]) throw fail('Invalid Inbox state action');
    const row = (await this.pool.query(`UPDATE iaic_inbox SET ${assignments[action]},version=version+1 WHERE namespace=$1 AND scope_id=$2 AND id=$3 RETURNING *`, [this.namespace, text(scopeId), uuid(id)])).rows[0];
    if (!row) throw fail('Inbox item not found', 404); return item(row);
  }
  async claim(scopeId, itemId, kind, requestKey) {
    if (!['conversation','task'].includes(kind)) throw fail('Invalid Inbox projection kind');
    text(scopeId); uuid(itemId); text(requestKey);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const args = [this.namespace, scopeId, kind, requestKey];
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify(args)]);
      let row = (await client.query('SELECT *,lease_until<=now() AS expired FROM iaic_inbox_projections WHERE namespace=$1 AND scope_id=$2 AND kind=$3 AND request_key=$4 FOR UPDATE', args)).rows[0];
      if (row && row.item_id !== itemId) throw fail('Projection key is bound to another Inbox item', 409);
      let claimed = false, changed = false;
      if (!row) {
        row = (await client.query(`INSERT INTO iaic_inbox_projections(id,namespace,scope_id,kind,request_key,item_id,state,attempt,lease_until)
          SELECT $5,$1,$2,$3,$4,id,'sending',$7,now()+interval '60 seconds' FROM iaic_inbox WHERE namespace=$1 AND scope_id=$2 AND id=$6 RETURNING *`, [...args, randomUUID(), itemId, randomUUID()])).rows[0];
        if (!row) throw fail('Inbox item not found', 404); claimed = changed = true;
      } else if (row.state === 'sending' && row.expired) {
        row = (await client.query("UPDATE iaic_inbox_projections SET state='unknown',result='{}' WHERE id=$1 RETURNING *", [row.id])).rows[0]; changed = true;
      } else if (row.state === 'not_sent') {
        row = (await client.query("UPDATE iaic_inbox_projections SET state='sending',attempt=$2,lease_until=now()+interval '60 seconds',result=NULL WHERE id=$1 RETURNING *", [row.id, randomUUID()])).rows[0]; claimed = changed = true;
      }
      if (changed) await client.query('INSERT INTO iaic_inbox_projection_history(projection_id,state,attempt,result) VALUES($1,$2,$3,$4)', [row.id,row.state,row.attempt,row.result]);
      await client.query('COMMIT'); return {projection: projection(row), claimed};
    } catch (error) {await client.query('ROLLBACK'); throw error;} finally {client.release();}
  }
  async finish(job, result) {
    if (!['delivered','not_sent','unknown'].includes(result?.status)) throw fail('Invalid projection result');
    const safe = {status: result.status};
    if (result.reference !== undefined) safe.reference = text(result.reference);
    if (safe.status === 'delivered' && !safe.reference) throw fail('Delivered projection requires a reference');
    const row = (await this.pool.query(`WITH changed AS (
      UPDATE iaic_inbox_projections SET state=$5,result=$6,lease_until=NULL WHERE namespace=$1 AND scope_id=$2 AND id=$3 AND attempt=$4 AND state IN ('sending','unknown') RETURNING *
    ), logged AS (INSERT INTO iaic_inbox_projection_history(projection_id,state,attempt,result) SELECT id,state,attempt,result FROM changed) SELECT * FROM changed`,
    [this.namespace,job.scopeId,job.id,job.attempt,safe.status,safe])).rows[0];
    if (!row) throw fail('Projection attempt already settled',409); return projection(row);
  }
  async history(scopeId, itemId) {
    return (await this.pool.query(`SELECT h.sequence::text,h.state,h.result,h.created_at FROM iaic_inbox_projection_history h
      JOIN iaic_inbox_projections p ON p.id=h.projection_id WHERE p.namespace=$1 AND p.scope_id=$2 AND p.item_id=$3 ORDER BY h.sequence`, [this.namespace,text(scopeId),uuid(itemId)])).rows;
  }
}
