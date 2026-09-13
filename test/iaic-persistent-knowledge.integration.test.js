import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';import {PostgresKnowledgeStore} from '@immedi/iaic-core/knowledge/postgres.js';import {KnowledgeCatalog} from '@immedi/iaic-core/knowledge/catalog.js';import {createKnowledgeCapabilities} from '@immedi/iaic-core/knowledge/tools.js';import {CapabilityDispatcher} from '@immedi/iaic-core/capabilities/index.js';import {ContextAssembler} from '@immedi/iaic-core/context/index.js';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
test('Persistent knowledge supports concurrent corrections, withdrawal, restoration and coherent current history',{skip:!url},async()=>{
 const admin=new Pool({connectionString:url}),schema='knowledge_store_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
 try{
  let store=new PostgresKnowledgeStore({pool,namespace:'references'});await store.initialize();
  const input={id:'refund-policy',title:'Refund reference',description:'Sourced policy guidance.',source:{kind:'policy',reference:'policy:approved-v1'},text:'Review the original receipt.',policy:{reader:'alice'},expectedRevision:0};
  const written=await store.put(input);assert.equal(written.entry.revision,1);store=new PostgresKnowledgeStore({pool,namespace:'references'});
  const knowledge=new KnowledgeCatalog({store,authorize:async(actor,entry)=>entry.policy.reader===actor.subjectId});const actor={subjectId:'alice'};
  // Catalog must use the coherent snapshot port, never a separate metadata/body pair.
  store.describe=async()=>{throw new Error('Separate metadata read must not run');};store.read=async()=>{throw new Error('Separate body read must not run');};
  const found=await knowledge.search(actor,{query:'receipt'});assert.equal(found.items.length,1);assert.equal(found.items[0].text,undefined);const original=await knowledge.read(actor,{id:input.id,expectedVersion:found.items[0].reference.version});assert.equal(original.text,input.text);
  assert.deepEqual((await knowledge.search({subjectId:'bob'})).items,[]);await assert.rejects(new PostgresKnowledgeStore({pool,namespace:'other'}).snapshot(input.id),{statusCode:404});
  const dispatcher=new CapabilityDispatcher({capabilities:createKnowledgeCapabilities({knowledge,authorize:async()=>true})}),context=new ContextAssembler({});const history={events:[],calls:[{id:'read',capability:'my_read_knowledge',input:{id:input.id},status:'succeeded',result:original}]};
  const corrections=await Promise.allSettled(['first correction','second correction'].map(text=>store.put({...input,text,expectedRevision:1})));assert.equal(corrections.filter(r=>r.status==='fulfilled').length,1);assert.equal(corrections.find(r=>r.status==='rejected').reason.statusCode,409);
  assert.equal((await context.revalidateHistory({history,actor,dispatcher})).calls[0].result.unavailable,true);
  const current=await knowledge.read(actor,{id:input.id});assert.equal(current.source.reference,input.source.reference);assert.notEqual(current.reference.version,original.reference.version);
  const withdrawn=await store.withdraw({id:input.id,expectedRevision:2});assert.equal(withdrawn.revision,3);assert.deepEqual(await store.state(input.id),withdrawn);assert.equal((await knowledge.search(actor)).items.length,0);await assert.rejects(store.put(input),{statusCode:409});assert.equal((await knowledge.revalidate(actor,current.reference)).unavailable,true);
  const row=(await pool.query('SELECT metadata,content FROM iaic_knowledge_documents WHERE namespace=$1 AND id=$2',['references',input.id])).rows[0];assert.equal(row.content,null);assert.deepEqual(row.metadata,{});
  await store.put({...input,source:{kind:'policy',reference:'policy:approved-v2'},text:input.text,expectedRevision:3});assert.equal((await store.state(input.id)).revision,4);assert.notEqual((await knowledge.read(actor,{id:input.id})).reference.version,original.reference.version);
  await store.put({...input,policy:{reader:'bob'},expectedRevision:4});assert.equal((await knowledge.revalidate(actor,(await knowledge.read({subjectId:'bob'},{id:input.id})).reference)).unavailable,true);
  await assert.rejects(store.put({...input,id:'invalid',source:{},expectedRevision:0}),{statusCode:400});await assert.rejects(store.put({...input,id:'large',text:'x'.repeat(60001)}),{statusCode:413});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
