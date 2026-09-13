import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {RetentionSweep,MemoryStore,PostgresKnowledgeStore,PostgresIngestedKnowledgeStore,KnowledgeIngestion} from '@immedi/iaic-core';
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw Error('Isolated PostgreSQL required');
const scope={applicationId:'retention',assistantId:'assistant',subjectId:'owner'},past='2000-01-01T00:00:00Z',future='2999-01-01T00:00:00Z';
async function fixture(run){const schema='retention_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});try{await run(pool);}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}}
const memoryInput=(key,expiresAt=past,expectedRevision=0)=>({key,kind:'note',content:'private body',source:{kind:'fixture'},expiresAt,expectedRevision});
const documentInput=(id,expiresAt=past,expectedRevision=0)=>({id,title:'private title',description:'private description',source:{kind:'fixture',reference:'private ref'},text:'private body',expiresAt,expectedRevision});
test('bounded scoped memory expiry erases payload and tombstones once under concurrent sweep',()=>fixture(async pool=>{
 const store=new MemoryStore({pool});await store.initialize();
 for(const key of ['a','b'])await store.remember(scope,memoryInput(key));await store.remember(scope,memoryInput('future',future));await store.remember({...scope,subjectId:'other'},memoryInput('a'));
 await pool.query("UPDATE iaic_memories SET dispute=$1,assessment=$1 WHERE subject_id='owner' AND memory_key='a'",[{reason:'private review'}]);
 const bound={expired:o=>store.expired(scope,o),expire:r=>store.expire(scope,r)};
 const sweep=new RetentionSweep({resolveStore:async()=>bound,authorize:async actor=>actor.admin===true});
 await assert.rejects(sweep.run({}, {sourceId:'memory'}),{statusCode:403});
 const [one,two]=await Promise.all([sweep.run({admin:true},{sourceId:'memory',limit:1}),sweep.run({admin:true},{sourceId:'memory',limit:1})]);
 assert.ok(one.erased.length+two.erased.length>=1);
 await sweep.run({admin:true},{sourceId:'memory'});assert.deepEqual(await bound.expired(),[]);
 const rows=(await pool.query("SELECT * FROM iaic_memories WHERE subject_id='owner' AND memory_key IN ('a','b')")).rows;
 for(const row of rows){assert.equal(row.revision,2);for(const key of ['content','source','dispute','assessment'])assert.equal(row[key],null);assert.equal(row.deleted,true);}
 assert.equal((await store.read(scope,{key:'future'})).status,'active');assert.equal((await store.read({...scope,subjectId:'other'},{key:'a'})).status,'expired');
 await assert.rejects(store.remember(scope,memoryInput('a',future)),{statusCode:409});
}));
test('expiry CAS preserves concurrent extension and isolates Knowledge namespace',()=>fixture(async pool=>{
 const memory=new MemoryStore({pool});await memory.initialize();await memory.remember(scope,memoryInput('renew'));
 const [ref]=await memory.expired(scope);await memory.remember(scope,memoryInput('renew',future,ref.revision));await assert.rejects(memory.expire(scope,ref),{statusCode:409});assert.equal((await memory.read(scope,{key:'renew'})).content,'private body');
 const store=new PostgresKnowledgeStore({pool,namespace:'one'}),other=new PostgresKnowledgeStore({pool,namespace:'two'});await store.initialize();await store.put(documentInput('expired'));await other.put(documentInput('expired'));
 const [doc]=await store.expired();await store.put(documentInput('expired',future,doc.revision));await assert.rejects(store.expire(doc),{statusCode:409});
 await store.put(documentInput('expired',past,2));const sweep=new RetentionSweep({resolveStore:async()=>store,authorize:async()=>true});assert.equal((await sweep.run({}, {sourceId:'knowledge'})).erased.length,1);
 assert.deepEqual(await store.state('expired'),{id:'expired',revision:4,withdrawn:true});assert.equal(await other.read('expired'),'private body');
 const row=(await pool.query("SELECT metadata,content FROM iaic_knowledge_documents WHERE namespace='one'")).rows[0];assert.deepEqual(row,{metadata:{},content:null});
}));
test('ingested expiry clears all chunks atomically and retains source revision',()=>fixture(async pool=>{
 const store=new PostgresIngestedKnowledgeStore({pool,namespace:'ingestion'});await store.initialize();
 const ingestion=new KnowledgeIngestion({store,chunkBytes:4,authorize:async()=>true,resolveSource:async(_a,{sourceId})=>({confirmed:true,sourceId,sourceRevision:'v1',mediaType:'text/plain',reference:'fixture',title:'title',description:'description',text:'abcdefghij',expiresAt:past})});
 await ingestion.sync({}, {sourceId:'source',expectedRevision:0});const [ref]=await store.expired();assert.equal((await store.list()).length,3);
 await pool.query("CREATE FUNCTION reject_expiry_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected delete failure'; END $$; CREATE TRIGGER reject_expiry BEFORE DELETE ON iaic_ingested_knowledge_chunks FOR EACH ROW EXECUTE FUNCTION reject_expiry_delete()");
 await assert.rejects(store.expire(ref),/injected delete failure/);assert.equal((await store.sourceState('source')).revision,1);assert.equal((await store.list()).length,3);
 await pool.query('DROP TRIGGER reject_expiry ON iaic_ingested_knowledge_chunks');
 assert.deepEqual(await store.expire(ref),{id:'source',revision:2});assert.deepEqual(await store.list(),[]);assert.deepEqual(await store.sourceState('source'),{sourceId:'source',revision:2,withdrawn:true});
 const row=(await pool.query('SELECT metadata,digest FROM iaic_ingested_knowledge_sources')).rows[0];assert.deepEqual(row,{metadata:null,digest:null});await assert.rejects(ingestion.sync({}, {sourceId:'source',expectedRevision:0}),{statusCode:409});
}));
test('sweep rechecks revocation and reports only confirmed progress after uncertain erasure',async()=>{
 let allowed=true,calls=0;
 const store={expired:async()=>[{id:'a',revision:1},{id:'b',revision:1}],expire:async({id})=>{calls++;allowed=false;return {id,revision:2};}};
 const sweep=new RetentionSweep({resolveStore:async()=>store,authorize:async()=>allowed});
 await assert.rejects(sweep.run({}, {sourceId:'fixture'}),error=>error.statusCode===403&&error.retentionProgress.erased.length===1);assert.equal(calls,1);
 const lost=new RetentionSweep({resolveStore:async()=>({...store,expire:async()=>{throw new Error('lost acknowledgement');}}),authorize:async()=>true});
 await assert.rejects(lost.run({}, {sourceId:'fixture'}),error=>error.retentionProgress.erased.length===0);assert.equal(calls,1);
});
