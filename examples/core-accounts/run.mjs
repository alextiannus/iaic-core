import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {PostgresAccountStore, AccountDirectory, createAccountCapabilities, CapabilityDispatcher, createCapabilityHttpHandler, CapabilityHttpClient} from '@immedi/iaic-core';

const connectionString = process.env.SUBMISSION_TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('Isolated PostgreSQL URL required');
const schema = 'accounts_example_' + randomUUID().replaceAll('-', '');
const admin = new Pool({connectionString}); await admin.query(`CREATE SCHEMA ${schema}`);
const pool = new Pool({connectionString, options: `-c search_path=${schema}`});
try {
  const store = new PostgresAccountStore({pool, namespace: 'example'}); await store.initialize();
  // Trusted provisioning; applications can instead map an existing identity provider/store.
  await store.put('account', 'user', {expectedRevision: 0});
  await store.put('organization', 'company', {expectedRevision: 0});
  await store.putMembership('company', 'user', {roles: ['member'], expectedRevision: 0});
  const directory = new AccountDirectory({store, namespace: 'example',
    resolveIdentity: request => request.headers.get('authorization') === 'Bearer example-token' ? {accountId: 'user', organizationId: 'company'} : null,
    authorize: ({actor, action, target}) => action === 'account.read' && target.id === actor.subjectId
  });
  const dispatcher = new CapabilityDispatcher({capabilities: createAccountCapabilities({directory})});
  const handler = createCapabilityHttpHandler({dispatcher, resolveAccess: async request => ({actor: await directory.actor(request), capabilities: ['directory.account.read']})});
  const client = new CapabilityHttpClient({url: 'https://example.test/capabilities', headers: () => ({authorization: 'Bearer example-token'}), fetch: (url, init) => handler(new Request(url, init))});
  assert.equal((await client.invoke('directory.account.read', {id: 'user'})).result.id, 'user');
  await store.putMembership('company', 'user', {state: 'removed', expectedRevision: 1});
  await assert.rejects(client.invoke('directory.account.read', {id: 'user'}), {statusCode: 403});
  console.log(JSON.stringify({example: 'core-accounts', status: 'passed', persistedDirectory: true, sharedHttpCapability: true, currentRevocation: true}));
} finally {await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();}
