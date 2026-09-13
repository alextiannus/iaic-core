import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {KnowledgeIngestion,PostgresIngestedKnowledgeStore,KnowledgeCatalog,splitKnowledgeText} from '@immedi/iaic-core';
async function fixture(run){
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;assert.ok(connectionString);const schema='ingestion_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
 try{const store=new PostgresIngestedKnowledgeStore({pool,namespace:'app'});await store.initialize();let source={confirmed:true,sourceId:'guide',sourceRevision:'v1',reference:'host://guides/guide',mediaType:'text/markdown',title:'Guide',description:'Sourced instructions',text:'中文🙂 first paragraph.\n\nSecond paragraph with facts.',policy:{owner:'reader'}};
 const actor={subjectId:'reader'},catalog=new KnowledgeCatalog({store,authorize:(a,entry)=>a.subjectId===entry.policy.owner}),ingestion=new KnowledgeIngestion({store,chunkBytes:24,authorize:a=>a.subjectId==='reader',resolveSource:()=>structuredClone(source)});
 await run({pool,store,catalog,ingestion,actor,source});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
test('UTF-8 splitting preserves every byte and rejects unsupported source sizes',()=>{
 const text='中文🙂\nabc'.repeat(15),chunks=splitKnowledgeText(text,{chunkBytes:7});assert.equal(chunks.map(c=>c.text).join(''),text);assert.ok(chunks.every(c=>Buffer.byteLength(c.text)<=7));assert.equal(chunks.at(-1).byteEnd,Buffer.byteLength(text));
 assert.throws(()=>splitKnowledgeText(text,{maxSourceBytes:5}),{statusCode:413});assert.throws(()=>splitKnowledgeText(text,{chunkBytes:4,maxChunks:1}),{statusCode:413});assert.throws(()=>splitKnowledgeText('\ud800'),{statusCode:400});
});
test('Sourced imports are idempotent, survive reconstruction and invalidate references on atomic replacement',()=>fixture(async({pool,store,catalog,ingestion,actor,source})=>{
 const created=await ingestion.sync(actor,{sourceId:'guide',expectedRevision:0});assert.ok(created.parts>1);assert.equal((await ingestion.sync(actor,{sourceId:'guide',expectedRevision:0})).unchanged,true);
 const rows=await store.list(),before=await Promise.all(rows.map(e=>catalog.read(actor,{id:e.id})));assert.equal(before.map(d=>d.text).join(''),source.text);assert.equal(before[0].source.sourceRevision,'v1');
 source.sourceRevision='v2';source.text='Corrected';const changed=await ingestion.sync(actor,{sourceId:'guide',expectedRevision:1});assert.equal(changed.revision,2);assert.equal(changed.parts,1);
 const restored=new KnowledgeCatalog({store:new PostgresIngestedKnowledgeStore({pool,namespace:'app'}),authorize:()=>true});assert.equal((await restored.read(actor,{id:rows[0].id})).text,'Corrected');assert.equal((await catalog.revalidate(actor,before[0].reference)).unavailable,true);await assert.rejects(catalog.read(actor,{id:rows.at(-1).id}),{statusCode:404});
 assert.equal((await new PostgresIngestedKnowledgeStore({pool,namespace:'other'}).list()).length,0);
}));
test('Concurrent corrections preserve one coherent source and failed replacement leaves original chunks',()=>fixture(async({pool,store,ingestion,actor,source})=>{
 await ingestion.sync(actor,{sourceId:'guide',expectedRevision:0});source.text='Changed without upstream version';await assert.rejects(ingestion.sync(actor,{sourceId:'guide',expectedRevision:1}),{statusCode:409});
 const a={...source,sourceRevision:'v2',text:'First correction'},b={...source,sourceRevision:'v3',text:'Other correction'};
 const make=source=>new KnowledgeIngestion({store,chunkBytes:8,authorize:()=>true,resolveSource:()=>source});
 const results=await Promise.allSettled([make(a).sync(actor,{sourceId:'guide',expectedRevision:1}),make(b).sync(actor,{sourceId:'guide',expectedRevision:1})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const snapshots=await Promise.all((await store.list()).map(e=>store.snapshot(e.id)));assert.equal(new Set(snapshots.map(s=>s.entry.source.sourceRevision)).size,1);assert.ok([a.text,b.text].includes(snapshots.map(s=>s.text).join('')));
 const previous=snapshots.map(s=>s.text).join('');
 // A storage failure after deleting the old chunks must roll back the entire source transaction.
 await pool.query("CREATE FUNCTION reject_new_chunks() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture insert failure'; END $$");await pool.query('CREATE TRIGGER reject_new_chunks BEFORE INSERT ON iaic_ingested_knowledge_chunks FOR EACH ROW EXECUTE FUNCTION reject_new_chunks()');
 await assert.rejects(make({...a,sourceRevision:'v4',text:'Replacement'}).sync(actor,{sourceId:'guide',expectedRevision:2}));assert.equal((await store.sourceState('guide')).revision,2);assert.equal((await Promise.all((await store.list()).map(e=>store.read(e.id)))).join(''),previous);
}));
test('Withdrawal clears all current content and policy; restoration requires the tombstone revision',()=>fixture(async({pool,store,catalog,ingestion,actor,source})=>{
 await ingestion.sync(actor,{sourceId:'guide',expectedRevision:0});const reference=(await catalog.search(actor,{})).items[0].reference;
 await assert.rejects(ingestion.withdraw({subjectId:'other'},{sourceId:'guide',expectedRevision:1}),{statusCode:403});await ingestion.withdraw(actor,{sourceId:'guide',expectedRevision:1});assert.equal((await catalog.revalidate(actor,reference)).unavailable,true);assert.equal((await store.list()).length,0);
 const persisted=(await pool.query('SELECT metadata,digest,withdrawn FROM iaic_ingested_knowledge_sources')).rows[0];assert.deepEqual(persisted,{metadata:null,digest:null,withdrawn:true});await assert.rejects(ingestion.sync(actor,{sourceId:'guide',expectedRevision:0}),{statusCode:409});
 await ingestion.sync(actor,{sourceId:'guide',expectedRevision:2});source.policy={owner:'other'};await ingestion.sync(actor,{sourceId:'guide',expectedRevision:3});assert.equal((await catalog.search(actor,{})).items.length,0);assert.equal((await catalog.revalidate(actor,reference)).unavailable,true);
}));
