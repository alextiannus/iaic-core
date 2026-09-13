import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {PlanCatalog} from '@immedi/iaic-core/subscriptions/plans.js';
import {PostgresSubscriptionStore} from '@immedi/iaic-core/subscriptions/store.js';
import {Subscriptions} from '@immedi/iaic-core/subscriptions/service.js';

async function fixture(run) {
  const connectionString = process.env.SUBMISSION_TEST_DATABASE_URL; assert.ok(connectionString);
  const schema = 'subscriptions_test_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({connectionString}); await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({connectionString, options: `-c search_path=${schema}`});
  try {await run(pool);} finally {await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();}
}
const plan = {id: 'basic', version: 'v1', entitlements: {assistant: true, agents: 2}};
const data = {sequence: 1, state: 'active', validFrom: '2030-01-01T00:00:00Z', validUntil: '2030-02-01T00:00:00Z', plan};

test('Subscription sources are persistent, replayable and cannot roll back a newer state', async () => fixture(async pool => {
  const store = new PostgresSubscriptionStore({pool, namespace: 'app'}); await store.initialize();
  const first = {scopeId: 'company:user', sourceId: 'activation', expectedRevision: 0, ...data};
  assert.equal((await store.apply(first)).subscription.revision, 1);
  await store.apply({...first, sourceId: 'pause', expectedRevision: 1, sequence: 3, state: 'paused'});
  const rebuilt = new PostgresSubscriptionStore({pool, namespace: 'app'});
  const replay = await rebuilt.apply(first);
  assert.equal(replay.replayed, true); assert.equal(replay.subscription.state, 'active');
  assert.equal((await rebuilt.get(first.scopeId)).state, 'paused');
  await assert.rejects(rebuilt.apply({...first, sourceId: 'late-unseen-event', expectedRevision: 2, sequence: 2}), {statusCode: 409});
  await assert.rejects(rebuilt.apply({...first, plan: {...plan, entitlements: {assistant: true, agents: 100}}}), {statusCode: 409});
  assert.equal(await new PostgresSubscriptionStore({pool, namespace: 'other'}).get(first.scopeId), null);
}));

test('Subscription updates enforce revisions, source ownership and transaction rollback', async () => fixture(async pool => {
  const store = new PostgresSubscriptionStore({pool, namespace: 'app'}); await store.initialize();
  const results = await Promise.allSettled(['a','b'].map(sourceId => store.apply({scopeId: 'owner', sourceId, expectedRevision: 0, ...data})));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.statusCode, 409);
  const current = await store.get('owner');
  await assert.rejects(store.apply({scopeId: 'other-owner', sourceId: current.sourceId, expectedRevision: 0, ...data}), {statusCode: 409});
  assert.equal(await store.get('other-owner'), null);
}));

test('Service checks current scope, period, pinned plan and confirmed sources without a wallet dependency', async () => fixture(async pool => {
  const store = new PostgresSubscriptionStore({pool, namespace: 'app'}); await store.initialize();
  const plans = new PlanCatalog([plan]);
  const sources = new Map([['activation', {sourceId: 'activation', scopeId: 'owner', confirmed: true, ...data, planId: plan.id, planVersion: plan.version}]]);
  let now = '2030-01-15T00:00:00Z', allowed = true;
  const service = new Subscriptions({store, plans, resolveScope: actor => actor.scope, authorize: () => allowed, resolveSource: id => sources.get(id), now: () => new Date(now)});
  const actor = {scope: 'owner'};
  await assert.rejects(service.apply({scope: 'other'}, {sourceId: 'activation', expectedRevision: 0}), {statusCode: 409});
  await service.apply(actor, {sourceId: 'activation', expectedRevision: 0});
  assert.equal((await service.require(actor, 'assistant')).value, true);
  await service.require(actor, 'agents', {atLeast: 2});
  await assert.rejects(service.require(actor, 'agents', {atLeast: 3}), {statusCode: 403});
  const copy = plans.get('basic', 'v1'); copy.entitlements.agents = 100;
  assert.equal((await service.read(actor)).entitlements.agents, 2);
  assert.throws(() => plans.register(plan), {statusCode: 409});
  plans.register({...plan, version: 'v2', entitlements: {assistant: false}});
  assert.equal((await service.read(actor)).subscription.plan.version, 'v1');
  now = '2030-02-01T00:00:00Z';
  assert.equal((await service.read(actor)).effective, false);
  await assert.rejects(service.require(actor, 'assistant'), {statusCode: 403});
  now = '2029-12-31T23:59:59Z'; assert.equal((await service.read(actor)).effective, false);
  sources.set('renewal', {...sources.get('activation'), sourceId: 'renewal', sequence: 2, validFrom: '2030-02-01T00:00:00Z', validUntil: '2030-03-01T00:00:00Z'});
  now = '2030-02-15T00:00:00Z'; await service.apply(actor, {sourceId: 'renewal', expectedRevision: 1});
  assert.equal((await service.read(actor)).effective, true);
  sources.set('cancel', {...sources.get('renewal'), sourceId: 'cancel', sequence: 3, state: 'cancelled'});
  await service.apply(actor, {sourceId: 'cancel', expectedRevision: 2});
  assert.deepEqual((await service.read(actor)).entitlements, {});
  allowed = false; await assert.rejects(service.read(actor), {statusCode: 403});
}));
