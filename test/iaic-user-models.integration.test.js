import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {UserModels} from '@immedi/iaic-core/credentials/user-models.js';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
test('BYOK validates, encrypts, isolates owners and revokes already-resolved models',{skip:!url},async()=>{
 const admin=new Pool({connectionString:url}),schema='byok_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
 try{
  let calls=0,seenKey;const factory=config=>({next:async()=>{seenKey=config.apiKey;calls++;if(config.apiKey==='invalid')throw new Error('Never expose invalid key');return {type:'finish',result:{ok:true},usage:{inputTokens:2,outputTokens:1}};}});
  const options={pool,encryptionKey:randomBytes(32).toString('base64'),endpoints:[{id:'approved',provider:'chat-completions',baseUrl:'https://model.example/v1'}],factory};
  const store=new UserModels(options);await store.initialize();const scope={applicationId:'app',subjectId:'user'};
  const saved=await store.save(scope,{label:'My model',model:'own-model',endpointId:'approved',apiKey:'user-secret'});assert.equal(calls,1);
  assert.equal(saved.credentialMode,'BYOK');assert.ok(!JSON.stringify(saved).includes('user-secret'));
  assert.ok(!JSON.stringify((await pool.query('SELECT * FROM iaic_user_models')).rows).includes('user-secret'));
  const restored=new UserModels(options),resolved=await restored.resolve(scope,saved.id,{expectedIdentity:saved.modelIdentity});
  await resolved.next({});assert.equal(seenKey,'user-secret');assert.equal(calls,2);
  for(const field of ['applicationId','subjectId']){assert.deepEqual(await store.list({...scope,[field]:'other'}),[]);await assert.rejects(store.resolve({...scope,[field]:'other'},saved.id),{statusCode:409});}
  await assert.rejects(store.save(scope,{label:'bad',model:'own',endpointId:'unapproved',apiKey:'user-secret'}),{statusCode:400});assert.equal(calls,2);
  await assert.rejects(store.save(scope,{label:'bad',model:'own',endpointId:'approved',apiKey:'invalid'}),e=>e.statusCode===422&&!e.message.includes('Never expose'));
  await store.revoke(scope,saved.id);assert.equal((await pool.query('SELECT secret FROM iaic_user_models')).rows[0].secret,null);
  const before=calls;await assert.rejects(resolved.next({}),e=>e.statusCode===409&&e.providerNotCalled);assert.equal(calls,before);assert.deepEqual(await store.list(scope),[]);
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
