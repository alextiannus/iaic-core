import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {AgentRuntime,TaskStore,MemoryStore,ContextAssembler,CapabilityDispatcher,defineCapability,createModelProvider} from '@immedi/iaic-core';

// A headless reference application. Its actor is independent of ERP and its
// task/memory tables live in a disposable schema owned by this invocation.
const connectionString=process.env.DATABASE_URL||process.env.SUBMISSION_TEST_DATABASE_URL;
if(!connectionString)throw new Error('Set DATABASE_URL to a disposable PostgreSQL database');
const admin=new Pool({connectionString}),schema='core_notes_'+randomUUID().replaceAll('-','');
await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let runtime;
const actor={scopeId:'notes-demo',subjectId:'reader'},scope={applicationId:'notes-demo',assistantId:'helper',subjectId:actor.subjectId};
const content='Keep explanations concise.';
try{
 const memories=new MemoryStore({pool});await memories.initialize();
 const current=async()=>{const rows=await memories.list(scope);return rows.find(r=>r.memory_key==='writing-style');};
 const output={type:'object',properties:{content:{type:'string'},revision:{type:'integer'}},required:['content','revision'],additionalProperties:false};
 const authorized=async a=>a.scopeId===actor.scopeId&&a.subjectId===actor.subjectId;
 const revalidate=async(_input,result)=>{const row=await current();if(!row||row.content!==result.content||row.revision!==result.revision)throw new Error('Note changed');return result;};
 const save=defineCapability({name:'notes.save',description:'Save the requested writing preference.',input:{type:'object',properties:{content:{type:'string',minLength:1,maxLength:1000}},required:['content'],additionalProperties:false},output,effect:'write',retry:'never-replay',authorize:authorized,revalidate,preflight:input=>input.content===content?true:{valid:false,feedback:'/content must match the original requested writing preference; use the user-provided content.'},implementation:{kind:'function',execute:async input=>{const row=await memories.remember(scope,{key:'writing-style',kind:'preference',content:input.content,source:{kind:'user-statement',reference:actor.subjectId},expectedRevision:0});return {content:row.content,revision:row.revision};}}});
 const read=defineCapability({name:'notes.read',description:'Read the saved writing preference.',input:{type:'object',properties:{},additionalProperties:false},output,effect:'read',authorize:authorized,revalidate,implementation:{kind:'function',execute:async()=>{const row=await current();if(!row)throw new Error('Save the note first');return {content:row.content,revision:row.revision};}}});
 const agent=defineCapability({name:'notes.assist',description:'Remember and verify a writing preference.',input:{type:'object',properties:{goal:{type:'string'}},required:['goal'],additionalProperties:false},output:{type:'object',properties:{remembered:{type:'boolean',const:true}},required:['remembered'],additionalProperties:false},effect:'write',retry:'never-replay',authorize:authorized,implementation:{kind:'agent',instructions:'Save the requested preference with notes.save, then verify it with notes.read, then finish with {"remembered":true}. Do not repeat a successful save.',tools:['notes.save','notes.read'],verify:async(_input,result,{history})=>result.remembered===true&&(await current())?.content===content&&history.calls.some(c=>c.capability==='notes.read'&&c.status==='succeeded')}});
 let step=0;const actions=[{type:'call',name:'notes.save',input:{content:'Incorrect fixture preference'}},{type:'call',name:'notes.save',input:{content}},{type:'call',name:'notes.read',input:{}},{type:'finish',result:{remembered:true}}];
 const live=Boolean(process.env.DEMO_MODEL_API_KEY);
 const model=live?createModelProvider({apiKey:process.env.DEMO_MODEL_API_KEY,model:process.env.DEMO_MODEL,provider:process.env.DEMO_PROVIDER||'openai',baseUrl:process.env.DEMO_BASE_URL||''}):{name:'deterministic-reference',next:async({messages})=>{if(step===1){const data=JSON.parse(messages[1].content);assert.match(data.events.find(e=>e.kind==='feedback').data.feedback,/original requested writing preference/);}return actions[step++];}};
 const store=new TaskStore({pool}),dispatcher=new CapabilityDispatcher({capabilities:[save,read,agent]});
 runtime=new AgentRuntime({store,dispatcher,model,context:new ContextAssembler({skillRoot:process.cwd()}),version:'core-notes-v1',maxTurns:8});dispatcher.tasks=runtime;await runtime.initialize();
 const task=await runtime.create({capability:agent,input:{goal:'Remember my writing preference: '+content},actor,idempotencyKey:'remember-preference'});
 const finished=await runtime.tick();assert.equal(finished.status,'succeeded',finished.error||finished.waiting_reason);
 assert.equal((await new TaskStore({pool}).get(actor,task.id)).status,'succeeded');
 if(!live){const history=await store.history(actor,task.id);assert.equal(history.calls.filter(c=>c.capability==='notes.save'&&c.status==='failed').length,1);assert.equal(history.calls.filter(c=>c.capability==='notes.save'&&c.status==='succeeded').length,1);}
 const snapshot=await new MemoryStore({pool}).export(scope);assert.equal(snapshot.memories.length,1);assert.equal(snapshot.memories[0].content,content);
 const destination={...scope,subjectId:'migrated-reader'};
 const imported=await memories.import(destination,{requestKey:'portable',snapshot,source:{kind:'user-statement',reference:'migrated-reader'}});
 assert.equal(imported.imported.length,1);const migrated=await memories.export(destination);assert.equal(migrated.memories[0].content,content);assert.equal(migrated.memories[0].source.kind,'user-import');
 await memories.forget(destination,{key:'writing-style',expectedRevision:1});assert.deepEqual(await memories.import(destination,{requestKey:'portable',snapshot,source:{kind:'user-statement',reference:'migrated-reader'}}),imported);assert.equal((await memories.export(destination)).memories.length,0);
 const tombstone=await memories.read(destination,{key:'writing-style'});assert.equal(tombstone.status,'forgotten');assert.equal(tombstone.content,null);
 await memories.relearn(destination,{key:'writing-style',kind:'preference',content:'Use concise technical examples.',expectedRevision:tombstone.revision,source:{kind:'user-statement',reference:'migrated-reader'}});
 assert.equal((await memories.read(destination,{key:'writing-style'})).revision,3);assert.equal((await memories.read(destination,{key:'writing-style'})).content,'Use concise technical examples.');
 assert.deepEqual(await memories.import(destination,{requestKey:'portable',snapshot,source:{kind:'user-statement',reference:'migrated-reader'}}),imported);assert.equal((await memories.read(destination,{key:'writing-style'})).revision,3);
 await memories.dispute(destination,{key:'writing-style',reason:'Preference needs confirmation',expectedRevision:3,source:{kind:'user-statement',reference:'migrated-reader'}});assert.deepEqual(await memories.list(destination),[]);assert.equal((await memories.list(destination,{status:'disputed'})).length,1);
 await memories.resolveDispute(destination,{key:'writing-style',kind:'preference',content:'Use short confirmed examples.',expectedRevision:4,source:{kind:'user-statement',reference:'migrated-reader'}});assert.equal((await memories.read(destination,{key:'writing-style'})).status,'active');
 console.log(JSON.stringify({application:'core-notes',modelMode:live?'provider':'deterministic',task:finished.status,preflightFeedback:!live,persisted:true,memoryExportVerified:true,memoryImportVerified:true,memoryRelearningVerified:true,memoryDisputeVerified:true,erpUsed:false}));
}finally{if(runtime)await runtime.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
