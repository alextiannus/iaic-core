import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {MemoryStore,AssistantMemory,createAssistantTaskCapabilities} from '@immedi/iaic-core';
const url=process.env.SUBMISSION_TEST_DATABASE_URL,scope={applicationId:'notes',assistantId:'helper',subjectId:'reader'};
async function database(run){const admin=new Pool({connectionString:url}),schema='memory_key_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});try{await run(pool);}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}}
async function fixture(pool){const store=new MemoryStore({pool});await store.initialize();return {store,memory:new AssistantMemory({store,resolveScope:async actor=>({...scope,subjectId:actor}),sourceFor:async actor=>({kind:'user-statement',reference:actor})})};}
test('Exact memory reads expose current status without expired or forgotten content',{skip:!url},()=>database(async pool=>{
 const {memory}=await fixture(pool);await memory.remember('reader',{key:'language',kind:'preference',content:'French'});
 const active=await memory.read('reader',{key:'language'});assert.equal(active.status,'active');assert.equal(active.content,'French');assert.equal(active.revision,1);
 await assert.rejects(memory.read('other',{key:'language'}),{statusCode:404});await assert.rejects(memory.read('reader',{key:'missing'}),{statusCode:404});
 await memory.remember('reader',{key:'language',kind:'preference',content:'Expired private text',expectedRevision:1,expiresAt:'2000-01-01T00:00:00Z'});
 const expired=await memory.read('reader',{key:'language'});assert.equal(expired.status,'expired');assert.equal(expired.content,null);assert.equal(expired.source,null);assert.equal(expired.revision,2);
 await memory.remember('reader',{key:'language',kind:'preference',content:'Japanese',expectedRevision:expired.revision});assert.equal((await memory.read('reader',{key:'language'})).content,'Japanese');
 await memory.forget('reader',{key:'language',expectedRevision:3});const forgotten=await memory.read('reader',{key:'language'});assert.equal(forgotten.status,'forgotten');assert.equal(forgotten.revision,4);assert.equal(forgotten.content,null);assert.equal(forgotten.source,null);
 assert.deepEqual(await memory.list('reader'),[]);assert.deepEqual((await memory.export('reader')).memories,[]);
}));
test('Explicit relearning requires new content and current tombstone revision, never stale ordinary writes',{skip:!url},()=>database(async pool=>{
 const {memory}=await fixture(pool);await memory.remember('reader',{key:'style',kind:'preference',content:'Old preference'});await memory.forget('reader',{key:'style',expectedRevision:1});
 const input={key:'style',kind:'preference',content:'New preference',expectedRevision:2};
 await assert.rejects(memory.remember('reader',{...input,relearn:true}),{statusCode:409});await assert.rejects(memory.relearn('reader',{...input,expectedRevision:1}),{statusCode:409});await assert.rejects(memory.relearn('reader',{...input,content:undefined}),{statusCode:400});
 const results=await Promise.allSettled(['New preference','Competing preference'].map(content=>memory.relearn('reader',{...input,content,source:{kind:'forged'}})));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.statusCode,409);
 const current=await memory.read('reader',{key:'style'});assert.equal(current.status,'active');assert.equal(current.revision,3);assert.equal(current.source.kind,'user-statement');assert.equal(current.source.reference,'reader');assert.notEqual(current.content,'Old preference');
 await assert.rejects(memory.relearn('reader',{...input,expectedRevision:3}),{statusCode:409});await assert.rejects(memory.forget('reader',{key:'style',expectedRevision:1}),{statusCode:409});
 await memory.forget('reader',{key:'style',expectedRevision:3});await assert.rejects(memory.relearn('reader',input),{statusCode:409});assert.equal((await memory.read('reader',{key:'style'})).revision,4);
}));
test('Read history updates to a content-free tombstone; relearning is an explicit non-default write',{skip:!url},()=>database(async pool=>{
 const {memory}=await fixture(pool);await memory.remember('reader',{key:'note',kind:'note',content:'Transient content'});
 const capabilities=createAssistantTaskCapabilities({memory,workspace:{},authorize:async()=>true,verifyOutcome:async()=>true});const reader=capabilities.find(c=>c.name==='my_read_assistant_memory'),writer=capabilities.find(c=>c.name==='my_relearn_assistant_memory'),agent=capabilities.find(c=>c.name==='assistant.run');
 const prior=await reader.implementation.execute({key:'note'},{actor:'reader'});assert.equal(prior.content,'Transient content');await memory.forget('reader',{key:'note',expectedRevision:1});const refreshed=await reader.revalidate({key:'note'},prior,{actor:'reader'});assert.equal(refreshed.status,'forgotten');assert.equal(refreshed.content,null);
 assert.equal(writer.effect,'write');assert.equal(writer.retry,'never-replay');assert.equal(agent.implementation.allowCall({}, {name:writer.name}),false);assert.equal(agent.implementation.allowCall({allowedTools:[writer.name]}, {name:writer.name}),true);
 const receipt=await writer.implementation.execute({key:'note',kind:'note',content:'New explicit statement',expectedRevision:2},{actor:'reader'});assert.deepEqual(receipt,{key:'note',revision:3});assert.equal((await writer.revalidate({},receipt,{actor:'reader'})).revision,3);
}));
test('Old import replay cannot replace a newly relearned statement',{skip:!url},()=>database(async pool=>{
 const {memory}=await fixture(pool);const input={requestKey:'original-import',snapshot:{format:'iaic.memory.export.v1',exportedAt:'2026-01-01T00:00:00Z',memories:[{memory_key:'migrated',kind:'note',content:'Old imported content',source:{kind:'user-statement'},revision:1,expires_at:null}]}};
 const receipt=await memory.import('reader',input);await memory.forget('reader',{key:'migrated',expectedRevision:1});await memory.relearn('reader',{key:'migrated',expectedRevision:2,kind:'note',content:'New user statement'});
 assert.deepEqual(await memory.import('reader',input),receipt);const current=await memory.read('reader',{key:'migrated'});assert.equal(current.content,'New user statement');assert.equal(current.revision,3);assert.equal(current.source.kind,'user-statement');
}));
