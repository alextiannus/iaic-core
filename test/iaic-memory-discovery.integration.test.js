import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {MemoryStore,AssistantMemory,CapabilityDispatcher,createAgentTaskCapabilities,ContextAssembler} from '@immedi/iaic-core';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
test('Memory discovery finds names and content while preserving scoped current visibility and explicit legacy search',{skip:!url},async()=>{
 const admin=new Pool({connectionString:url}),schema='memory_discovery_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
 try{
 const store=new MemoryStore({pool});await store.initialize();const actor={id:'owner',subjectId:'owner',scopeId:'app'},scope={applicationId:'app',assistantId:'assistant',subjectId:'owner'};let allowed=true;
 const memory=new AssistantMemory({store,resolveScope:async a=>{if(!allowed||a.id!==actor.id)throw Object.assign(new Error('Denied'),{statusCode:403});return scope;},sourceFor:()=>({kind:'fixture-user'})});
 await memory.remember(actor,{key:'presentation',kind:'preference',content:'Sort identifiers descending.',expectedRevision:0});
 await memory.remember(actor,{key:'another',kind:'note',content:'presentation advice',expectedRevision:0});
 await memory.remember(actor,{key:'literal_%',kind:'note',content:'Special name',expectedRevision:0});
 await store.remember({...scope,subjectId:'other'},{key:'presentation-private',kind:'note',content:'Other owner',source:{kind:'fixture'},expectedRevision:0});
 const capabilities=createAgentTaskCapabilities({memory,workspace:{},authorize:()=>true,verifyOutcome:()=>true}),dispatcher=new CapabilityDispatcher({capabilities});
 const lookup=options=>dispatcher.invoke('my_list_assistant_memories',options,{actor});
 const found=await lookup({query:'PRESENTATION'});assert.deepEqual(found.map(x=>x.memory_key).sort(),['another','presentation']);
 assert.deepEqual((await lookup({query:'presentation',searchIn:'content'})).map(x=>x.memory_key),['another']);
 assert.deepEqual((await lookup({query:'_%'})).map(x=>x.memory_key),['literal_%']);
 await assert.rejects(lookup({query:'presentation',searchIn:'semantic'}),{statusCode:400});
 await memory.dispute(actor,{key:'presentation',reason:'Please review',expectedRevision:1});assert.deepEqual((await lookup({query:'presentation'})).map(x=>x.memory_key),['another']);assert.equal((await lookup({query:'presentation',status:'disputed'}))[0].memory_key,'presentation');
 await memory.forget(actor,{key:'another',expectedRevision:1});assert.deepEqual(await lookup({query:'presentation'}),[]);
 const history={events:[],calls:[{id:'old-read',capability:'my_list_assistant_memories',input:{query:'PRESENTATION'},status:'succeeded',result:found}]};const current=await new ContextAssembler({}).revalidateHistory({history,actor,dispatcher});assert.deepEqual(current.calls[0].result,[]);
 allowed=false;await assert.rejects(lookup({query:'presentation'}),{statusCode:403});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
