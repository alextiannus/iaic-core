import {Pool} from 'pg';import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {KnowledgeCatalog,FileKnowledgeStore,PostgresKnowledgeStore,KnowledgeIngestion,PostgresIngestedKnowledgeStore,knowledgeTools} from '@immedi/iaic-core';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'core-knowledge-'));
try{
 await fs.writeFile(path.join(root,'reference.md'),'Workspace stores drafts; a draft does not prove a business action happened.');
 const knowledge=new KnowledgeCatalog({store:new FileKnowledgeStore({root,entries:[{id:'drafts',file:'reference.md',title:'Draft references',description:'Working drafts and business facts.',source:{kind:'example',reference:'example:drafts'}}]}),authorize:async actor=>actor.subjectId==='reader'});
 const actor={subjectId:'reader'},tools=knowledgeTools(knowledge,actor);
 const discovered=await tools[0].handler({query:'business action'}),reference=discovered.items[0].reference;
 const loaded=await tools[1].handler({id:reference.id,expectedVersion:reference.version});assert.match(loaded.text,/does not prove/);
 assert.equal(discovered.items[0].text,undefined);assert.deepEqual((await knowledge.search({subjectId:'other'})).items,[]);
 await fs.writeFile(path.join(root,'reference.md'),'Corrected reference');assert.equal((await knowledge.revalidate(actor,reference)).unavailable,true);
 const url=process.env.DATABASE_URL||process.env.SUBMISSION_TEST_DATABASE_URL;if(!url)throw new Error('Isolated PostgreSQL URL required');const admin=new Pool({connectionString:url}),schema='knowledge_example_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
 try{const store=new PostgresKnowledgeStore({pool,namespace:'references'});await store.initialize();await store.put({id:'drafts',title:'Draft references',description:'Persisted source',source:{kind:'example',reference:'example:drafts'},text:'A draft is not proof of completion.',expectedRevision:0});const persisted=new KnowledgeCatalog({store:new PostgresKnowledgeStore({pool,namespace:'references'}),authorize:async()=>true});const reference=(await persisted.read(actor,{id:'drafts'})).reference;await store.withdraw({id:'drafts',expectedRevision:1});assert.equal((await persisted.revalidate(actor,reference)).unavailable,true);
 const chunks=new PostgresIngestedKnowledgeStore({pool,namespace:'imported'});await chunks.initialize();const text='中文🙂 sourced document. '.repeat(2000);
 const ingestion=new KnowledgeIngestion({store:chunks,authorize:a=>a.subjectId==='reader',resolveSource:async()=>({confirmed:true,sourceId:'guide',sourceRevision:'v1',mediaType:'text/markdown',reference:'fixture:guide',title:'Imported guide',description:'Large versioned reference',text,policy:{owner:'reader'}})});
 const receipt=await ingestion.sync(actor,{sourceId:'guide',expectedRevision:0});assert.ok(receipt.parts>1);
 const catalog=new KnowledgeCatalog({store:chunks,authorize:(a,e)=>a.subjectId===e.policy.owner});const found=await catalog.search(actor,{query:'sourced'});assert.ok(found.items.length>1);const documents=await Promise.all((await chunks.list()).map(e=>catalog.read(actor,{id:e.id})));assert.equal(documents.map(d=>d.text).join(''),text);assert.ok(documents.every(d=>d.source.ingestionRevision===1));
 await ingestion.withdraw(actor,{sourceId:'guide',expectedRevision:1});assert.equal((await catalog.revalidate(actor,found.items[0].reference)).unavailable,true);
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
 console.log(JSON.stringify({application:'core-knowledge',chunkedIngestion:true,atomicSourceWithdrawal:true,persistentSource:true,sourcedReference:true,onDemandRead:true,revocationAndVersionChecks:true,erpUsed:false}));
}finally{await fs.rm(root,{recursive:true,force:true});}
