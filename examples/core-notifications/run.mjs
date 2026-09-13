import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {EventStore, createHttpNotificationChannel, PostgresNotificationStore, Notifications, createNotificationCapabilities, CapabilityDispatcher} from '@immedi/iaic-core';
const connectionString = process.env.SUBMISSION_TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('Isolated PostgreSQL URL required');
const schema = 'notifications_example_' + randomUUID().replaceAll('-', '');
const admin = new Pool({connectionString}); await admin.query(`CREATE SCHEMA ${schema}`);
const pool = new Pool({connectionString, options: `-c search_path=${schema}`});
try {
  const events = new EventStore({pool}); await events.initialize();
  const event = await events.publish({applicationId: 'example', assistantId: 'worker', subjectId: 'owner'}, {key: 'task-result', data: {summary: 'Background work completed'}, source: {kind: 'fixture-task'}});
  const store = new PostgresNotificationStore({pool, namespace: 'example'}); await store.initialize();
  const delivered = new Map();
  const channel=createHttpNotificationChannel({baseUrl:'https://notification-fixture.invalid/v1/',idempotencyHeader:'Idempotency-Key',resolveHeaders:()=>({authorization:'Bearer fixture-only'}),bindings:{send:{request:input=>({path:'send',body:{recipient:'host-recipient',message:input.message}}),project:body=>body}},fetch:async(_url,options)=>{const input=JSON.parse(options.body),key=options.headers.get('idempotency-key');assert.equal(input.recipient,'host-recipient');delivered.set(key,input.message);return new Response(JSON.stringify({status:'delivered',idempotencyKey:key,reference:'fixture:'+key}));}});
  const notifications = new Notifications({store, resolveScope: actor => actor.subjectId, authorize: actor => actor.subjectId === 'owner',
    resolveDelivery: async job => ({allowed: job.scopeId === 'owner' && job.recipientId === 'owner' && job.channel === 'fixture', ...channel})});
  const dispatcher = new CapabilityDispatcher({capabilities: createNotificationCapabilities({notifications})}), actor = {subjectId: 'owner'};
  const input = {requestKey: event.id, recipientId: 'owner', channel: 'fixture', message: {text: event.data.summary}, source: {eventId: event.id, digest: event.digest}};
  await dispatcher.invoke('notifications.enqueue', input, {actor, callId: 'queue-result'});
  await dispatcher.invoke('notifications.enqueue', input, {actor, callId: 'queue-result'});
  assert.equal((await notifications.tick()).state, 'delivered');
  assert.equal((await dispatcher.invoke('notifications.get', {requestKey: event.id}, {actor})).state, 'delivered');
  assert.equal(delivered.size, 1);
  console.log(JSON.stringify({example: 'core-notifications', status: 'passed', eventReference: true, durableQueue: true, httpChannelAdapter: true, sharedCapability: true, externalMessagesSent: false}));
} finally {await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();}
