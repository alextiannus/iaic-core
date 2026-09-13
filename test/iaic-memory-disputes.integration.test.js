import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {MemoryStore,AssistantMemory,ContextAssembler,createAssistantTaskCapabilities} from '@immedi/iaic-core';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
test('Memory disputes suspend retrieval, preserve contested reads and require explicit revision-based correction',{skip:!url},async()=>{
 const admin=new Pool({connectionString:url}),schema='memory_dispute_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
 const scope={applicationId:'test',assistantId:'assistant',subjectId:'owner'},actor='owner',source={kind:'user-statement',by:'trusted-owner'};
 try{
  const store=new MemoryStore({pool});await store.initialize();const memory=new AssistantMemory({store,resolveScope:async who=>({...scope,subjectId:who}),sourceFor:async()=>source});
  const input={key:'preference',kind:'preference',content:'Use Monday',expectedRevision:0};await memory.remember(actor,input);
  const capabilities=createAssistantTaskCapabilities({memory,workspace:{},authorize:async()=>true,verifyOutcome:async()=>true});
  const read=capabilities.find(c=>c.name==='my_read_assistant_memory'),disputeCap=capabilities.find(c=>c.name==='my_dispute_assistant_memory');assert.equal(disputeCap.effect,'write');assert.equal(capabilities.find(c=>c.name==='my_resolve_assistant_memory_dispute').effect,'write');
  const receipt=await disputeCap.implementation.execute({key:input.key,reason:'The user says the weekday changed',expectedRevision:1},{actor});assert.deepEqual(receipt,{key:input.key,revision:2});
  assert.deepEqual(await memory.list(actor),[]);assert.equal((await memory.list(actor,{status:'disputed'}))[0].memory_key,input.key);assert.deepEqual(await memory.list('other',{status:'disputed'}),[]);await assert.rejects(memory.list(actor,{status:'anything'}),{statusCode:400});assert.deepEqual((await memory.export(actor)).memories,[]);
  const current=await memory.read(actor,{key:input.key});assert.equal(current.status,'disputed');assert.equal(current.content,input.content);assert.deepEqual(current.dispute.source,source);
  const context=new ContextAssembler({skillRoot:'/tmp',memoryProvider:()=>memory.list(actor)});
  const messages=await context.assemble({task:{input:{goal:'Plan next work'}},capability:{implementation:{instructions:'Work',skills:[]}},history:{calls:[],events:[]},actor,dispatcher:{}});assert.deepEqual(JSON.parse(messages[1].content).memories,[]);
  const refreshed=await read.revalidate({key:input.key},{content:'old accepted claim'},{actor});assert.equal(refreshed.status,'disputed');
  await assert.rejects(memory.read('other',{key:input.key}),{statusCode:404});await assert.rejects(memory.resolveDispute('other',{...input,expectedRevision:2}),{statusCode:409});
  await assert.rejects(memory.remember(actor,{...input,content:'Silent overwrite',expectedRevision:2}),{statusCode:409});
  await assert.rejects(memory.resolveDispute(actor,{...input,expectedRevision:1}),{statusCode:409});
  const corrected=await memory.resolveDispute(actor,{...input,content:'Use Tuesday',expectedRevision:2,source:{kind:'invented-authority'}});assert.equal(corrected.revision,3);assert.deepEqual(corrected.source,source);assert.equal((await memory.list(actor))[0].content,'Use Tuesday');
  await assert.rejects(memory.resolveDispute(actor,{...input,expectedRevision:3}),{statusCode:409});
  const race=await Promise.allSettled([memory.dispute(actor,{key:input.key,reason:'Needs checking',expectedRevision:3}),memory.remember(actor,{...input,content:'Concurrent update',expectedRevision:3})]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.find(r=>r.status==='rejected').reason.statusCode,409);
  let row=await memory.read(actor,{key:input.key});if(!row.disputed)await memory.dispute(actor,{key:input.key,reason:'Check before expiry',expectedRevision:row.revision});
  await pool.query('UPDATE iaic_memories SET expires_at=now()-interval \'1 second\' WHERE memory_key=$1',[input.key]);
  row=await memory.read(actor,{key:input.key});assert.equal(row.status,'expired');assert.equal(row.disputed,true);assert.equal(row.content,null);assert.equal(row.dispute,null);
  await memory.forget(actor,{key:input.key,expectedRevision:row.revision});row=await memory.read(actor,{key:input.key});assert.equal(row.status,'forgotten');assert.equal(row.disputed,false);assert.equal(row.dispute,null);
  assert.equal((await pool.query('SELECT dispute FROM iaic_memories WHERE memory_key=$1',[input.key])).rows[0].dispute,null);
  await assert.rejects(memory.resolveDispute(actor,{...input,expectedRevision:row.revision}),{statusCode:409});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
