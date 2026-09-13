import fs from 'node:fs/promises';
import {canonical, fail, key, snapshot} from './contracts.js';
const view = row => row ? {scopeId: row.scope_id, sourceId: row.source_id, revision: row.revision, ...row.snapshot} : null;

export class PostgresSubscriptionStore {
  constructor({pool, namespace}) {this.pool = pool; this.namespace = key(namespace);}
  async initialize() {await this.pool.query(await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8'));}
  async get(scopeId) {return view((await this.pool.query('SELECT * FROM iaic_subscriptions WHERE namespace=$1 AND scope_id=$2', [this.namespace, key(scopeId)])).rows[0]);}
  async apply({scopeId, sourceId, expectedRevision, ...value}) {
    key(scopeId); key(sourceId);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= 2147483647) throw fail('Expected revision required; zero creates');
    const data = snapshot(value), payload = JSON.stringify(canonical({scopeId, ...data}));
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify(['iaic-subscription', this.namespace, scopeId])]);
      const prior = (await db.query('SELECT * FROM iaic_subscription_sources WHERE namespace=$1 AND source_id=$2', [this.namespace, sourceId])).rows[0];
      if (prior) {
        if (prior.payload !== payload) throw fail('Subscription source was already bound to different facts', 409);
        await db.query('COMMIT');
        return {subscription: prior.result, replayed: true};
      }
      const current = view((await db.query('SELECT * FROM iaic_subscriptions WHERE namespace=$1 AND scope_id=$2', [this.namespace, scopeId])).rows[0]);
      if ((current?.revision ?? 0) !== expectedRevision) throw fail('Subscription revision changed', 409);
      if (current && data.sequence <= current.sequence) throw fail('Subscription source sequence is stale', 409);
      const subscription = {scopeId, sourceId, revision: expectedRevision + 1, ...data};
      await db.query(`INSERT INTO iaic_subscriptions(namespace,scope_id,revision,snapshot,source_id) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(namespace,scope_id) DO UPDATE SET revision=EXCLUDED.revision,snapshot=EXCLUDED.snapshot,source_id=EXCLUDED.source_id,updated_at=now()`, [this.namespace, scopeId, subscription.revision, data, sourceId]);
      await db.query('INSERT INTO iaic_subscription_sources(namespace,source_id,scope_id,payload,result) VALUES($1,$2,$3,$4,$5)', [this.namespace, sourceId, scopeId, payload, subscription]);
      await db.query('COMMIT');
      return {subscription, replayed: false};
    } catch (error) {
      await db.query('ROLLBACK');
      if (error.code === '23505') throw fail('Subscription source is already bound; reconcile before retrying', 409);
      throw error;
    } finally {db.release();}
  }
}
