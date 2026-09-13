import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {PlanCatalog, PostgresSubscriptionStore, Subscriptions, createSubscriptionCapabilities, CapabilityDispatcher, TokenLedger, AllowanceIssuer} from '@immedi/iaic-core';
const connectionString = process.env.SUBMISSION_TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('Isolated PostgreSQL URL required');
const schema = 'subscriptions_example_' + randomUUID().replaceAll('-', '');
const admin = new Pool({connectionString}); await admin.query(`CREATE SCHEMA ${schema}`);
const pool = new Pool({connectionString, options: `-c search_path=${schema}`});
try {
  const store = new PostgresSubscriptionStore({pool, namespace: 'example'}); await store.initialize();
  const plans = new PlanCatalog([{id: 'basic', version: '1', entitlements: {assistant: true}}]);
  const actor = {subjectId: 'owner'}, scope = {applicationId: 'example', subjectId: 'owner'};
  const source = {sourceId: 'verified-period-1', scopeId: 'owner', confirmed: true, sequence: 1, state: 'active', planId: 'basic', planVersion: '1', validFrom: '2030-01-01T00:00:00Z', validUntil: '2030-02-01T00:00:00Z'};
  const subscriptions = new Subscriptions({store, plans, resolveScope: a => a.subjectId, authorize: a => a.subjectId === 'owner', resolveSource: id => id === source.sourceId ? source : null, now: () => new Date('2030-01-15T00:00:00Z')});
  const dispatcher = new CapabilityDispatcher({capabilities: createSubscriptionCapabilities({subscriptions})});
  const ledger = new TokenLedger({pool}); await ledger.initialize();
  const receipt = await dispatcher.invoke('subscriptions.apply', {sourceId: source.sourceId, expectedRevision: 0}, {actor, callId: 'apply-period'});
  assert.equal(receipt.replayed, false);
  assert.equal((await dispatcher.invoke('subscriptions.read', {}, {actor})).effective, true);
  assert.equal((await ledger.balance(scope)).balance, '0');
  // The host independently decides whether a confirmed subscription period grants
  // platform units. The subscription module neither prices nor issues them itself.
  const issuer = new AllowanceIssuer({ledger, authorize: a => a.subjectId === 'owner', resolveSource: async id => {
    if (id !== source.sourceId) return null;
    await subscriptions.require(actor, 'assistant');
    return {sourceId: id, confirmed: true, scope, amount: 50, evidence: {subscriptionSource: id, allocationPolicy: 'fixture-50-units'}};
  }});
  await issuer.issue(actor, {sourceId: source.sourceId});
  await issuer.issue(actor, {sourceId: source.sourceId});
  assert.equal((await ledger.balance(scope)).balance, '50');
  console.log(JSON.stringify({example: 'core-subscriptions', status: 'passed', independentEntitlements: true, separateIdempotentAllowance: true, providerInvoked: false}));
} finally {await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();}
