import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {TaskStore,AgentRuntime,defineCapability,WorkspaceLineage,AssistantWorkspace,PostgresWorkspaceStore,AssistantMemory,MemoryStore,KnowledgeCatalog,PostgresKnowledgeStore,createAssistantTaskCapabilities,ContextAssembler,CapabilityDispatcher} from '@immedi/iaic-core';
async function fixture(fn){
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');
 const schema='lineage_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
 try{
  const actor={scopeId:'fixture',subjectId:'owner'},scope=a=>({applicationId:'fixture',assistantId:'helper',subjectId:a.subjectId}),sourceFor=()=>({kind:'fixture'});
  const memoryStore=new MemoryStore({pool}),store=new PostgresWorkspaceStore({pool}),knowledgeStore=new PostgresKnowledgeStore({pool,namespace:'fixture'});await Promise.all([memoryStore.initialize(),store.initialize(),knowledgeStore.initialize()]);
  const memory=new AssistantMemory({store:memoryStore,resolveScope:scope,sourceFor}),knowledge=new KnowledgeCatalog({store:knowledgeStore,authorize:a=>a.subjectId==='owner'}),sources=new Map();
  const build=()=>new AssistantWorkspace({store,resolveScope:scope,sourceFor,lineage:new WorkspaceLineage({capture:({input})=>sources.get(input.path)??[],readMemory:(a,r)=>memory.read(a,r),readKnowledge:(a,r)=>knowledge.read(a,{id:r.id,expectedVersion:r.version}),readWorkspace:(a,r)=>store.read(scope(a),{path:r.path}),authorizePurge:()=>true})});
  const workspace=build();await fn({pool,actor,scope,memory,memoryStore,knowledge,knowledgeStore,store,sources,workspace,build});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
test('Forgotten Memory invalidates transitive Workspace results and authorized purge erases derived bodies',async()=>fixture(async f=>{
 await f.memory.remember(f.actor,{key:'preference',kind:'preference',content:'Sensitive fixture preference'});
 f.sources.set('a.md',[{kind:'memory',reference:{key:'preference',revision:1}}]);const first=await f.workspace.write(f.actor,{path:'a.md',content:'Derived sensitive text'});
 f.sources.set('b.md',[{kind:'workspace',reference:first.reference}]);const second=await f.workspace.write(f.actor,{path:'b.md',content:'Second derived sensitive text'});
 assert.equal((await f.build().read(f.actor,second.reference)).content,'Second derived sensitive text');
 await assert.rejects(f.workspace.read({subjectId:'other'},second.reference),{statusCode:404});
 await f.memory.forget(f.actor,{key:'preference',expectedRevision:1});
 for(const artifact of [first,second])await assert.rejects(f.build().read(f.actor,artifact.reference),{code:'SOURCE_INVALIDATED'});
 assert.deepEqual((await f.workspace.list(f.actor)).items,[]);
 const caps=createAssistantTaskCapabilities({memory:f.memory,workspace:f.workspace,authorize:()=>true,verifyOutcome:async()=>true});
 const dispatcher=new CapabilityDispatcher({capabilities:caps}),context=new ContextAssembler({skillRoot:'/tmp'});
 const raw={calls:[{id:randomUUID(),capability:'my_read_workspace',input:first.reference,status:'succeeded',result:{...first,content:'Derived sensitive text'}}],events:[]};
 const visible=await context.revalidateHistory({history:raw,actor:f.actor,dispatcher});assert.equal(visible.calls[0].result.unavailable,true);assert.equal(JSON.stringify(visible).includes('Derived sensitive text'),false);
 const removed=await f.workspace.purgeInvalid(f.actor);assert.equal(removed.removed.length,2);assert.equal((await f.pool.query('SELECT * FROM iaic_workspace_versions')).rowCount,0);
}));
test('Knowledge correction invalidates old derivations while explicitly rewritten current work remains available',async()=>fixture(async f=>{
 const entry={id:'source',title:'Source',description:'Fixture',source:{kind:'fixture',reference:'source'},text:'Original',expectedRevision:0};await f.knowledgeStore.put(entry);
 const source=await f.knowledge.read(f.actor,{id:'source'});f.sources.set('report.md',[{kind:'knowledge',reference:source.reference}]);const old=await f.workspace.write(f.actor,{path:'report.md',content:'Original derivation'});
 await f.knowledgeStore.put({...entry,expectedRevision:1,text:'Corrected'});
 await assert.rejects(f.workspace.read(f.actor,old.reference),{code:'SOURCE_INVALIDATED'});
 const current=await f.knowledge.read(f.actor,{id:'source'});f.sources.set('report.md',[{kind:'knowledge',reference:current.reference}]);const replacement=await f.workspace.write(f.actor,{path:'report.md',expectedRevision:1,content:'Corrected derivation'});
 assert.equal((await f.workspace.read(f.actor,replacement.reference)).content,'Corrected derivation');await assert.rejects(f.workspace.read(f.actor,old.reference),{code:'SOURCE_INVALIDATED'});
 assert.equal((await f.workspace.purgeInvalid(f.actor)).removed.length,0);
 await f.knowledgeStore.withdraw({id:'source',expectedRevision:2});await assert.rejects(f.workspace.read(f.actor,replacement.reference),{code:'SOURCE_INVALIDATED'});
 await f.workspace.purgeInvalid(f.actor);assert.equal((await f.pool.query('SELECT * FROM iaic_workspace_versions')).rowCount,0);
}));
test('Purge cannot delete a concurrent correction and unresolved lineage never triggers erasure',async()=>fixture(async f=>{
 await f.memory.remember(f.actor,{key:'source',kind:'note',content:'Old'});f.sources.set('result.md',[{kind:'memory',reference:{key:'source',revision:1}}]);await f.workspace.write(f.actor,{path:'result.md',content:'Old result'});
 await f.memory.dispute(f.actor,{key:'source',reason:'Needs correction',expectedRevision:1});
 f.workspace.lineage.authorizePurge=async()=>{f.sources.set('result.md',[]);await f.workspace.write(f.actor,{path:'result.md',content:'Independently corrected',expectedRevision:1});return true;};
 assert.equal((await f.workspace.purgeInvalid(f.actor)).removed.length,0);assert.equal((await f.workspace.read(f.actor,{path:'result.md'})).content,'Independently corrected');
 await f.store.write(f.scope(f.actor),{path:'legacy.md',content:'Untracked',source:{kind:'fixture'}});
 await assert.rejects(f.workspace.read(f.actor,{path:'legacy.md'}),{statusCode:503});await assert.rejects(f.workspace.purgeInvalid(f.actor),{statusCode:503});assert.equal((await f.store.read(f.scope(f.actor),{path:'legacy.md'})).content,'Untracked');
}));

test('Runtime supplies trusted Task context for source capture and removes invalid derived content on continuation',async()=>fixture(async f=>{
 const taskStore=new TaskStore({pool:f.pool});let runtime,step=0,capturedTask;
 f.workspace.lineage.capture=async({actor,context})=>{
  assert.ok(context.taskId);capturedTask=context.taskId;
  const history=await taskStore.history(actor,context.taskId),call=history.calls.find(c=>c.capability==='my_read_assistant_memory'&&c.status==='succeeded');
  return [{kind:'memory',reference:{key:call.result.key,revision:call.result.revision}}];
 };
 await f.memory.remember(f.actor,{key:'source',kind:'note',content:'Source statement'});
 const capabilities=createAssistantTaskCapabilities({memory:f.memory,workspace:f.workspace,authorize:()=>true,verifyOutcome:async()=>true});
 const cap=defineCapability({name:'lineage.run',description:'Track derived work',input:{type:'object'},output:{type:'object'},effect:'write',retry:'never-replay',authorize:()=>true,implementation:{kind:'agent',instructions:'Use current source evidence',tools:['my_read_assistant_memory','my_write_workspace','my_read_workspace'],verify:async()=>true}});
 const dispatcher=new CapabilityDispatcher({capabilities:[...capabilities,cap]}),model={name:'fixture',next:async request=>{
  switch(step++){
   case 0:return {type:'call',name:'my_read_assistant_memory',input:{key:'source'}};
   case 1:return {type:'call',name:'my_write_workspace',input:{path:'derived.md',content:'Derived marker must disappear',expectedRevision:0}};
   case 2:return {type:'call',name:'my_read_workspace',input:{path:'derived.md'}};
   case 3:return {type:'wait',question:'Wait for source update'};
   default:assert.equal(JSON.stringify(request.messages).includes('Derived marker must disappear'),false);return {type:'finish',result:{verifiedUnavailable:true}};
  }
 }};
 try{
  runtime=new AgentRuntime({store:taskStore,dispatcher,model,context:new ContextAssembler({skillRoot:'/tmp'}),version:'lineage-fixture'});dispatcher.tasks=runtime;await runtime.initialize();
  const task=await runtime.create({actor:f.actor,capability:cap,input:{goal:'Continue after source update'},idempotencyKey:'lineage'});assert.equal((await runtime.tick()).waiting_reason,'input');assert.equal(capturedTask,task.id);
  await f.memory.forget(f.actor,{key:'source',expectedRevision:1});await runtime.transition(f.actor,task.id,{action:'provide_input',input:'Source withdrawn; check current availability'});assert.equal((await runtime.tick()).status,'succeeded');
 }finally{await runtime?.stop();}
}));
