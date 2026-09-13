import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {PostgresNotificationStore} from '@immedi/iaic-core/notifications/store.js';
import {Notifications} from '@immedi/iaic-core/notifications/service.js';
async function fixture(run) {
  const connectionString = process.env.SUBMISSION_TEST_DATABASE_URL; assert.ok(connectionString);
  const schema = 'notifications_test_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({connectionString}); await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({connectionString, options: `-c search_path=${schema}`});
  try {await run(pool);} finally {await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();}
}
const actor = {subjectId: 'owner'};
const payload = {requestKey: 'task-finished', recipientId: 'owner', channel: 'fixture', message: {text: 'Task complete'}, source: {taskId: 'task'}};
const service = (store, resolveDelivery) => new Notifications({store, resolveScope: a => a.subjectId, authorize: a => a.subjectId === 'owner', resolveDelivery});

test('Notification queue deduplicates, isolates scopes and claims one delivery across workers', async () => fixture(async pool => {
  const store = new PostgresNotificationStore({pool, namespace: 'app'}); await store.initialize();
  const first = await store.enqueue('owner', payload), again = await store.enqueue('owner', payload);
  assert.equal(first.id, again.id);
  await assert.rejects(store.enqueue('owner', {...payload, message: {text: 'different'}}), {statusCode: 409});
  assert.equal(await store.get('other', payload.requestKey), null);
  const claims = await Promise.all([store.claim(), store.claim()]);
  assert.equal(claims.filter(Boolean).length, 1);
  await store.finish(claims.find(Boolean), {status: 'delivered', reference: 'receipt'});
  const rebuilt = new PostgresNotificationStore({pool, namespace: 'app'});
  assert.equal((await rebuilt.get('owner', payload.requestKey)).state, 'delivered');
  assert.equal((await rebuilt.history('owner', payload.requestKey)).length, 1);
}));

test('Lost delivery responses and expired workers do not trigger a blind resend', async () => fixture(async pool => {
  const store = new PostgresNotificationStore({pool, namespace: 'app'}); await store.initialize();
  let sent = 0;
  const notifications = service(store, async () => ({allowed: true, send: async () => {sent++; throw new Error('Receipt lost after provider acceptance');}, query: async () => ({status: 'delivered', reference: 'provider-accepted'})}));
  await notifications.enqueue(actor, payload);
  assert.equal((await notifications.tick()).state, 'unknown');
  assert.equal(await notifications.tick(), null); assert.equal(sent, 1);
  await assert.rejects(notifications.retry(actor, payload), {statusCode: 409});
  assert.equal((await notifications.reconcile(actor, payload)).state, 'delivered');
  await notifications.enqueue(actor, {...payload, requestKey: 'worker-crash'});
  const claimed = await store.claim();
  await pool.query("UPDATE iaic_notifications SET lease_until=now()-interval '1 second' WHERE id=$1", [claimed.id]);
  assert.equal(await notifications.tick(), null);
  assert.equal((await store.get('owner', 'worker-crash')).state, 'unknown');
  assert.equal(sent, 1);
}));

test('Pre-send denial can be retried after policy changes, pending cancellation stops delivery', async () => fixture(async pool => {
  const store = new PostgresNotificationStore({pool, namespace: 'app'}); await store.initialize();
  let allowed = false, sent = 0;
  const notifications = service(store, async () => ({allowed, send: async () => {sent++; return {status: 'delivered', reference: 'delivered'};}}));
  await notifications.enqueue(actor, payload);
  assert.equal((await notifications.tick()).state, 'failed'); assert.equal(sent, 0);
  allowed = true;
  await notifications.retry(actor, payload);
  assert.equal((await notifications.tick()).state, 'delivered');
  assert.equal((await notifications.history(actor, payload)).length, 2);
  await notifications.enqueue(actor, {...payload, requestKey: 'cancel'});
  await notifications.cancel(actor, {requestKey: 'cancel'});
  assert.equal(await notifications.tick(), null); assert.equal(sent, 1);
  await assert.rejects(notifications.get({subjectId: 'other'}, payload), {statusCode: 403});
}));
