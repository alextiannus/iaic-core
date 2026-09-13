import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {MemoryStore} from '@immedi/iaic-core/memory/store.js';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
test('persistent memory isolates identities, rejects stale updates and purges forgotten content',{skip:!url},async()=>{
 const admin=new Pool({connectionString:url}),schema='memory_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
 try{
  const store=new MemoryStore({pool});await store.initialize();
  const scope={applicationId:'app',assistantId:'assistant',subjectId:'user'};
  const first=await store.remember(scope,{key:'language',kind:'preference',content:'Use Chinese, 100% of the time',source:{kind:'user',reference:'request-1'}});
  for(const name of ['applicationId','assistantId','subjectId'])assert.deepEqual(await store.list({...scope,[name]:'other'}),[]);
  assert.equal((await new MemoryStore({pool}).list(scope,{query:'100%'})).length,1);
  assert.equal((await store.list(scope,{query:'_'})).length,0);
  await assert.rejects(store.remember(scope,{key:'language',kind:'preference',content:'replacement',source:{kind:'user'}}),{statusCode:409});
  const changed=await store.remember(scope,{key:'language',kind:'preference',content:'Use English',source:{kind:'user'},expectedRevision:first.revision});
  assert.equal(changed.revision,2);
  await assert.rejects(store.forget(scope,{key:'language',expectedRevision:1}),{statusCode:409});
  await assert.rejects(store.forget({...scope,subjectId:'other'},{key:'language',expectedRevision:2}),{statusCode:409});
  await store.forget(scope,{key:'language',expectedRevision:2});assert.deepEqual(await store.list(scope),[]);
  const row=(await pool.query('SELECT * FROM iaic_memories')).rows[0];assert.equal(row.content,null);assert.equal(row.source,null);
  await assert.rejects(store.remember(scope,{key:'language',kind:'preference',content:'stale',source:{kind:'user'},expectedRevision:2}),{statusCode:409});
  await store.remember(scope,{key:'expired',kind:'fact',content:'Old fact',source:{kind:'document'},expiresAt:'2000-01-01T00:00:00Z'});assert.deepEqual(await store.list(scope),[]);
  await assert.rejects(store.list({...scope,subjectId:''}),{statusCode:401});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
test('memory export is a complete active snapshot beyond list limits and never silently truncates',{skip:!url},async()=>{
 const admin=new Pool({connectionString:url}),schema='memory_export_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
 try{
  const store=new MemoryStore({pool});await store.initialize();const scope={applicationId:'app',assistantId:'assistant',subjectId:'user'};
  await pool.query("INSERT INTO iaic_memories(application_id,assistant_id,subject_id,memory_key,kind,content,source) SELECT 'app','assistant','user','key-'||n,'note','memory '||n,'{\"kind\":\"fixture\"}'::jsonb FROM generate_series(1,60) n");
  await store.forget(scope,{key:'key-1',expectedRevision:1});await store.remember(scope,{key:'key-2',kind:'note',content:'expired',source:{kind:'fixture'},expectedRevision:1,expiresAt:'2000-01-01T00:00:00Z'});
  const snapshot=await store.export(scope);assert.equal(snapshot.format,'iaic.memory.export.v1');assert.equal(snapshot.memories.length,58);assert.ok(snapshot.memories.every(r=>r.memory_key!=='key-1'&&r.memory_key!=='key-2'));assert.equal(snapshot.memories[0].source.kind,'fixture');
  for(const field of ['applicationId','assistantId','subjectId'])assert.deepEqual((await store.export({...scope,[field]:'other'})).memories,[]);
  await pool.query("INSERT INTO iaic_memories(application_id,assistant_id,subject_id,memory_key,kind,content,source) SELECT 'app','assistant','user','extra-'||n,'note','memory','{\"kind\":\"fixture\"}'::jsonb FROM generate_series(1,1001) n");await assert.rejects(store.export(scope),{statusCode:413});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
