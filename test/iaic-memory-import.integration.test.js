import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {MemoryStore,AssistantMemory,createAssistantTaskCapabilities} from '@immedi/iaic-core';
import {memoryTools} from '@immedi/iaic-core/memory/tools.js';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
const scope={applicationId:'standalone',assistantId:'helper',subjectId:'reader'};
const row=(key,content='A user note')=>({memory_key:key,kind:'note',content,source:{kind:'user-statement',reference:'old-user'},revision:7,expires_at:null});
const snapshot=memories=>({format:'iaic.memory.export.v1',exportedAt:'2026-01-01T00:00:00Z',memories});
async function database(run){const admin=new Pool({connectionString:url}),schema='memory_import_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});try{await run(pool);}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}}
async function fixture(pool){const store=new MemoryStore({pool});await store.initialize();const memory=new AssistantMemory({store,resolveScope:async actor=>({...scope,subjectId:actor}),sourceFor:async actor=>({kind:'user-statement',reference:actor})});return {store,memory};}
test('Memory exports import across accounts with trusted current source, fresh revisions and stable receipts',{skip:!url},()=>database(async pool=>{
 const {memory}=await fixture(pool);for(let i=0;i<60;i++)await memory.remember('old',{key:'key-'+i,kind:'note',content:'User note '+i});
 const exported=await memory.export('old');assert.equal(exported.memories.length,60);
 const receipt=await memory.import('reader',{requestKey:'migration',snapshot:exported,source:{kind:'verified-authority'}});assert.equal(receipt.imported.length,60);
 const current=await memory.export('reader');assert.equal(current.memories.length,60);const first=current.memories[0];assert.equal(first.revision,1);assert.equal(first.source.kind,'user-import');assert.equal(first.source.importedBy.reference,'reader');assert.equal(first.source.claimedSource.reference,'old');
 assert.equal((await memory.export('other')).memories.length,0);
 const reconstructed=new AssistantMemory({store:new MemoryStore({pool}),resolveScope:async()=>scope,sourceFor:async()=>({kind:'user-statement',reference:'renamed-reader'})});
 assert.deepEqual(await reconstructed.import({}, {requestKey:'migration',snapshot:JSON.parse(JSON.stringify(exported))}),receipt);
 await memory.forget('reader',{key:first.memory_key,expectedRevision:1});assert.deepEqual(await memory.import('reader',{requestKey:'migration',snapshot:exported}),receipt);assert.equal((await memory.export('reader')).memories.length,59);
 const audit=(await pool.query('SELECT * FROM iaic_memory_imports')).rows[0];assert.ok(!JSON.stringify(audit).includes('User note'));assert.equal(audit.receipt.imported.length,60);
}));
test('Import conflicts roll back the entire batch, including existing and forgotten keys',{skip:!url},()=>database(async pool=>{
 const {memory}=await fixture(pool);await memory.remember('reader',{key:'z-existing',kind:'note',content:'Original'});
 const batch=snapshot([row('a-new'),row('z-existing','Replacement')]);await assert.rejects(memory.import('reader',{requestKey:'conflict',snapshot:batch}),{statusCode:409});assert.deepEqual((await memory.export('reader')).memories.map(r=>r.memory_key),['z-existing']);assert.equal((await pool.query('SELECT * FROM iaic_memory_imports')).rowCount,0);
 await memory.forget('reader',{key:'z-existing',expectedRevision:1});await assert.rejects(memory.import('reader',{requestKey:'forgotten',snapshot:batch}),{statusCode:409});assert.deepEqual((await memory.export('reader')).memories,[]);
 const invalid=snapshot([row('a-good'),{...row('z-bad'),source:{kind:'claim',text:'x'.repeat(4100)}}]);await assert.rejects(memory.import('reader',{requestKey:'invalid-source',snapshot:invalid}),{statusCode:400});assert.deepEqual((await memory.export('reader')).memories,[]);
}));
test('Import concurrent replay is exactly once, payload changes conflict, expiry is explicit',{skip:!url},()=>database(async pool=>{
 const {memory}=await fixture(pool),batch=snapshot([row('active'),{...row('expired'),expires_at:'2000-01-01T00:00:00Z'}]);
 const results=await Promise.all(Array.from({length:5},()=>memory.import('reader',{requestKey:'same',snapshot:batch})));for(const result of results)assert.deepEqual(result,results[0]);assert.deepEqual(results[0].skippedExpired,['expired']);assert.equal((await memory.export('reader')).memories.length,1);
 const reordered=JSON.parse(JSON.stringify(batch));reordered.memories.reverse();reordered.memories[1].source={reference:'old-user',kind:'user-statement'};assert.deepEqual(await memory.import('reader',{requestKey:'same',snapshot:reordered}),results[0]);
 await assert.rejects(memory.import('reader',{requestKey:'same',snapshot:snapshot([row('active','Different')])}),{statusCode:409});
 await assert.rejects(memory.import('reader',{requestKey:'duplicate',snapshot:snapshot([row('x'),row('x')])}),{statusCode:400});
 await assert.rejects(memory.import('reader',{requestKey:'large',snapshot:snapshot(Array.from({length:1001},(_,i)=>row('k'+i)))}),{statusCode:413});
 const overlap=await Promise.allSettled(['one','two'].map(requestKey=>memory.import('reader',{requestKey,snapshot:snapshot([row('shared')])})));assert.equal(overlap.filter(r=>r.status==='fulfilled').length,1);assert.equal(overlap.find(r=>r.status==='rejected').reason.statusCode,409);
}));
test('Import tool is a write, excluded from default tools, and history revalidation cannot import again',{skip:!url},()=>database(async pool=>{
 const {memory}=await fixture(pool);const descriptor=memoryTools(memory,'reader').find(t=>t.name==='my_import_assistant_memories');const input={requestKey:'tool',snapshot:snapshot([row('portable')])};const receipt=await descriptor.handler(input);assert.equal(receipt.imported[0].key,'portable');
 const capabilities=createAssistantTaskCapabilities({memory,workspace:{},authorize:async()=>true,verifyOutcome:async()=>true});const capability=capabilities.find(c=>c.name===descriptor.name);assert.equal(capability.effect,'write');assert.equal(capability.retry,'never-replay');
 const agent=capabilities.find(c=>c.name==='assistant.run');assert.equal(agent.implementation.allowCall({goal:'Read'},{name:descriptor.name}),false);assert.equal(agent.implementation.allowCall({allowedTools:[descriptor.name]},{name:descriptor.name}),true);
 let called=false;memory.import=()=>{called=true;throw new Error('Do not replay');};assert.deepEqual(await capability.revalidate(input,receipt,{actor:'reader'}),receipt);assert.equal(called,false);
}));
test('A committed import with a lost acknowledgement is recovered without a second write',{skip:!url},()=>database(async pool=>{
 await fixture(pool);let failOnce=true;
 const flaky=new MemoryStore({pool:{connect:async()=>{const client=await pool.connect();return {query:async(...args)=>{const result=await client.query(...args);if(args[0]==='COMMIT'&&failOnce){failOnce=false;throw new Error('Lost commit acknowledgement');}return result;},release:()=>client.release()};}}});
 const input={requestKey:'lost-ack',snapshot:snapshot([row('durable')]),source:{kind:'user-statement',reference:'reader'}};
 await assert.rejects(flaky.import(scope,input),/Lost commit acknowledgement/);
 const restored=new MemoryStore({pool});const receipt=await restored.import(scope,input);assert.equal(receipt.imported.length,1);assert.equal((await restored.export(scope)).memories[0].revision,1);assert.equal((await pool.query('SELECT * FROM iaic_memory_imports')).rowCount,1);
}));
