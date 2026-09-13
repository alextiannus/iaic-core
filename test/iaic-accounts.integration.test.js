import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {PostgresAccountStore} from '@immedi/iaic-core/accounts/store.js';
import {AccountDirectory} from '@immedi/iaic-core/accounts/service.js';

async function fixture(run) {
  const connectionString = process.env.SUBMISSION_TEST_DATABASE_URL;
  assert.ok(connectionString, 'Isolated PostgreSQL URL required');
  const schema = 'accounts_test_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({connectionString}); await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({connectionString, options: `-c search_path=${schema}`});
  try { await run(pool); } finally {await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();}
}
const create = {expectedRevision: 0};
const directory = store => new AccountDirectory({store, namespace: 'app', resolveIdentity: context => context?.verified ? {accountId: context.accountId, organizationId: context.organizationId} : null,
  authorize: ({current, actor, target, action}) => current.membership?.roles.includes('directory-manager') || (action === 'account.read' && target.id === actor.subjectId) || (action === 'membership.listForAccount' && target.accountId === actor.subjectId)});

test('Account directory persists independent organizations, checks current membership and paginates', async () => fixture(async pool => {
  const store = new PostgresAccountStore({pool, namespace: 'app'}); await store.initialize();
  await store.put('account', 'user', create);
  await store.put('organization', 'company-a', create);
  await store.put('organization', 'company-b', create);
  await store.putMembership('company-a', 'user', {...create, roles: ['directory-manager']});
  await store.putMembership('company-b', 'user', {...create, roles: []});
  const service = directory(store);
  await assert.rejects(service.actor({accountId: 'user'}), {statusCode: 401});
  const a = await service.actor({verified: true, accountId: 'user', organizationId: 'company-a'});
  const b = await service.actor({verified: true, accountId: 'user', organizationId: 'company-b'});
  assert.notEqual(a.scopeId, b.scopeId);
  assert.equal((await service.get(a, 'organization', 'company-a')).state, 'active');
  await assert.rejects(service.put(b, 'organization', 'company-b', {expectedRevision: 1}), {statusCode: 403});
  assert.equal((await service.listMemberships(a, 'user', {limit: 1}))[0].organizationId, 'company-a');
  assert.equal((await service.listMemberships(a, 'user', {after: 'company-a'}))[0].organizationId, 'company-b');
  const fresh = directory(new PostgresAccountStore({pool, namespace: 'app'}));
  assert.equal((await fresh.current(a)).membership.roles[0], 'directory-manager');
  await service.putMembership(a, 'company-a', 'user', {state: 'removed', expectedRevision: 1});
  await assert.rejects(fresh.current(a), {statusCode: 403});
  assert.equal((await fresh.current(b)).organization.id, 'company-b');
  await store.put('account', 'user', {state: 'suspended', expectedRevision: 1});
  await assert.rejects(fresh.current(b), {statusCode: 403});
}));

test('Account storage rejects stale concurrent changes and cross-namespace references', async () => fixture(async pool => {
  const store = new PostgresAccountStore({pool, namespace: 'app'}); await store.initialize();
  await store.put('account', 'user', create); await store.put('organization', 'company', create);
  await assert.rejects(store.put('account', 'invalid-profile', {...create, profile: new Date()}), {statusCode: 400});
  assert.equal(await store.get('account', 'invalid-profile'), null);
  const results = await Promise.allSettled([store.put('account', 'user', {expectedRevision: 1, profile: {label: 'one'}}), store.put('account', 'user', {expectedRevision: 1, profile: {label: 'two'}})]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.statusCode, 409);
  const other = new PostgresAccountStore({pool, namespace: 'other-app'});
  assert.equal(await other.get('account', 'user'), null);
  await assert.rejects(other.putMembership('company', 'user', create), {statusCode: 409});
  await store.putMembership('company', 'user', create);
  await store.put('organization', 'company', {state: 'suspended', expectedRevision: 1});
  assert.equal(await store.access('user', 'company'), null);
}));

test('Directory uses a replaceable existing-system adapter and rechecks revocation', async () => {
  let active = true;
  const account = {id: 'external-user', state: 'active', profile: {}, revision: 1};
  const unsupported = () => {throw new Error('Host did not expose this operation');};
  const store = {get: async () => account, put: unsupported, membership: async () => null, putMembership: unsupported, listMembers: async () => [], listMemberships: async () => [], access: async id => active && id === account.id ? {account, organization: null, membership: null} : null};
  const service = new AccountDirectory({store, namespace: 'existing-application', resolveIdentity: async token => token === 'verified-token' ? {accountId: account.id} : null, authorize: ({action}) => action === 'account.read'});
  const actor = await service.actor('verified-token');
  assert.equal((await service.get(actor, 'account', actor.subjectId)).id, account.id);
  active = false;
  await assert.rejects(service.get(actor, 'account', actor.subjectId), {statusCode: 403});
});
