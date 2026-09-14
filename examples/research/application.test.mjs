import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {CapabilityDispatcher,PostgresWorkspaceStore,AssistantWorkspace,AgentRuntime,TaskStore,ContextAssembler} from '@immedi/iaic-core';import {researchCapabilities} from './application.js';
test('research uses scoped sources, rejects unsupported quotes, preserves idempotent artifacts and revocation',async()=>{
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');
 const schema='research_test_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
 try{
  const documents=JSON.parse(await fs.readFile(new URL('./documents.json',import.meta.url))),actor={scopeId:'test',subjectId:'reader'},scope={applicationId:'test',subjectId:'reader',assistantId:'research'};let revoked=false;
  const store=new PostgresWorkspaceStore({pool});await store.initialize();const workspace=new AssistantWorkspace({store,resolveScope:()=>scope,sourceFor:()=>({kind:'test'})});
  const capabilities=researchCapabilities({documents,workspace,canRead:a=>!revoked&&a.subjectId===actor.subjectId});const dispatcher=new CapabilityDispatcher({capabilities});
  const options={actor,callId:'stable-request'};
  assert.deepEqual((await dispatcher.invoke('documents.search',{documentIds:['interview-a','interview-b'],query:''},options)).map(x=>x.id),['interview-a','interview-b']);
  await assert.rejects(dispatcher.invoke('documents.read',{id:'interview-a'},{actor:{scopeId:'test',subjectId:'other'}}),{statusCode:403});
  const input={documentIds:['interview-a'],report:{title:'Finding',sections:[{claim:'Operations requests daily notifications.',evidence:[{documentId:'interview-a',quote:'Operations wants daily digest notifications at 09:00.'}]}]}};
  const saved=await dispatcher.invoke('reports.save',input,options);assert.deepEqual(await dispatcher.invoke('reports.save',input,options),saved);
  const changed=structuredClone(input);changed.report.title='Changed';await assert.rejects(dispatcher.invoke('reports.save',changed,options));
  const invented=structuredClone(input);invented.report.sections[0].evidence[0].quote='Both teams prefer CSV.';await assert.rejects(dispatcher.invoke('reports.save',invented,{actor,callId:'invalid'}));await assert.rejects(workspace.read(actor,{path:'reports/invalid.json'}),{statusCode:404});
  const agent=capabilities.find(x=>x.name==='research.prepare');assert.equal(await agent.implementation.allowCall({documentIds:['interview-a']},{name:'documents.read',input:{id:'interview-b'}}),false);
  assert.equal(await agent.implementation.verify({documentIds:['interview-a']},saved,{actor}),true);
  assert.equal(await agent.implementation.verify({documentIds:['interview-b']},saved,{actor}),false);
  const model={name:'deterministic-wiring-only',next:async({messages})=>{
   const context=JSON.parse(messages[1].content),calls=context.calls.filter(c=>c.status==='succeeded');
   assert.ok(JSON.stringify(context).includes('Source-based research'));
   if(!calls.length)return {type:'call',name:'documents.read',input:{id:'interview-a'}};
   if(calls.length===1)return {type:'call',name:'reports.save',input};
   return {type:'finish',result:calls.at(-1).result};
  }};
  const runtime=new AgentRuntime({store:new TaskStore({pool}),dispatcher,model,context:new ContextAssembler({skillRoot:new URL('./',import.meta.url).pathname}),version:'research-wiring-v1'});dispatcher.tasks=runtime;
  try{await runtime.initialize();const task=await dispatcher.invoke('research.prepare',{goal:'Document the notification preference.',documentIds:['interview-a']},{actor,callId:'research-wiring'});const terminal=await runtime.tick();assert.equal(terminal.status,'succeeded',JSON.stringify({error:terminal.error,waiting:terminal.waiting_reason}));const persisted=await runtime.get(actor,task.id);assert.equal(persisted.status,'succeeded');assert.ok(persisted.result.reference);}
  finally{await runtime.stop();}
  revoked=true;await assert.rejects(agent.implementation.verify({documentIds:['interview-a']},saved,{actor}),{statusCode:403});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
