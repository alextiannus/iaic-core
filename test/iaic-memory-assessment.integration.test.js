import {memoryTools} from '@immedi/iaic-core/memory/tools.js';
import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {MemoryStore,AssistantMemory,PostgresWorkspaceStore,AssistantWorkspace,WorkspaceLineage,CapabilityDispatcher,createAssistantTaskCapabilities} from '@immedi/iaic-core';
async function fixture(fn){
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');
 const schema='assessment_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
 try{
  const actor={subjectId:'owner'},reviewer={subjectId:'owner',role:'reviewer'},scope=a=>({applicationId:'fixture',assistantId:'helper',subjectId:a.subjectId}),store=new MemoryStore({pool});await store.initialize();
  const config={store,resolveScope:scope,sourceFor:()=>({kind:'user-statement'})},memory=new AssistantMemory({...config,authorizeAssessment:a=>a.role==='reviewer',assessmentSourceFor:()=>({kind:'reviewer',reference:'fixture-reviewer-v1'})});
  await memory.remember(actor,{key:'statement',kind:'note',content:'Original user statement'});await fn({actor,reviewer,scope,store,pool,memory,config});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
const judgment={key:'statement',expectedRevision:1,level:'contradicted',reason:'Fixture source contradicts the statement',evidence:[{kind:'source',reference:'fixture-source-v1'}]};
test('Assessment requires trusted reviewer policy and excludes contradicted memory from default retrieval',async()=>fixture(async f=>{
 await assert.rejects(new AssistantMemory(f.config).assess(f.reviewer,judgment),{statusCode:503});await assert.rejects(f.memory.assess(f.actor,judgment),{statusCode:403});
 await f.memory.assess(f.reviewer,{...judgment,assessor:{kind:'forged',reference:'model'}});const value=await f.memory.read(f.actor,{key:'statement'});
 assert.equal(value.revision,2);assert.equal(value.status,'contradicted');assert.equal(value.assessment.assessor.reference,'fixture-reviewer-v1');assert.equal(value.assessment.basedOnRevision,1);assert.ok(Date.parse(value.assessment.assessedAt));
 assert.deepEqual(await f.memory.list(f.actor),[]);assert.equal((await f.memory.list(f.actor,{status:'contradicted'})).length,1);assert.equal((await f.memory.export(f.actor)).memories.length,0);
 await f.memory.assess(f.reviewer,{...judgment,expectedRevision:2,level:'unassessed',reason:'Withdraw the previous judgment',evidence:[]});assert.equal((await f.memory.list(f.actor)).length,1);
 await f.memory.remember(f.actor,{key:'statement',kind:'note',content:'New user content',expectedRevision:3});assert.equal((await f.memory.read(f.actor,{key:'statement'})).assessment,null);
}));
test('Assessment races use the original revision and forgetting erases current judgment metadata',async()=>fixture(async f=>{
 const results=await Promise.allSettled([f.memory.assess(f.reviewer,judgment),f.memory.remember(f.actor,{key:'statement',kind:'note',content:'Concurrent correction',expectedRevision:1})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 await assert.rejects(f.memory.assess(f.reviewer,judgment),{statusCode:409});await assert.rejects(f.memory.assess({subjectId:'other',role:'reviewer'},judgment),{statusCode:409});
 const current=await f.memory.read(f.actor,{key:'statement'});await f.memory.forget(f.actor,{key:'statement',expectedRevision:current.revision});
 const row=(await f.pool.query('SELECT content,source,assessment FROM iaic_memories')).rows[0];assert.deepEqual(row,{content:null,source:null,assessment:null});
 await assert.rejects(f.memory.assess(f.reviewer,{...judgment,expectedRevision:current.revision+1}),{statusCode:409});
}));
test('Assessment changes invalidate derived source references and optional tools remain explicit writes',async()=>fixture(async f=>{
 const store=new PostgresWorkspaceStore({pool:f.pool});await store.initialize();
 const workspace=new AssistantWorkspace({store,resolveScope:f.scope,sourceFor:()=>({kind:'fixture'}),lineage:new WorkspaceLineage({capture:()=>[{kind:'memory',reference:{key:'statement',revision:1}}],readMemory:(a,r)=>f.memory.read(a,r)})});
 const artifact=await workspace.write(f.actor,{path:'derived.md',content:'Derived statement'});await f.memory.assess(f.reviewer,judgment);await assert.rejects(workspace.read(f.actor,artifact.reference),{code:'SOURCE_INVALIDATED'});
 const descriptor=memoryTools(f.memory,f.reviewer).find(t=>t.name==='my_assess_assistant_memory');assert.equal(descriptor.effect,'write');assert.deepEqual(descriptor.projectHistoryInput(judgment),{key:'statement',expectedRevision:1,level:'contradicted'});
 assert.equal(memoryTools(new AssistantMemory(f.config),f.actor).some(t=>t.name===descriptor.name),false);
 const capabilities=createAssistantTaskCapabilities({memory:f.memory,workspace,authorize:()=>true,verifyOutcome:async()=>true});assert.equal(capabilities.find(c=>c.name===descriptor.name).effect,'write');
 const dispatcher=new CapabilityDispatcher({capabilities});await assert.rejects(dispatcher.invoke(descriptor.name,{...judgment,expectedRevision:2},{actor:f.actor,callId:'denied'}),e=>e.statusCode===403&&!e.outcomeUnknown);
 await f.memory.dispute(f.actor,{key:'statement',expectedRevision:2,reason:'Request a correction'});assert.equal((await f.memory.read(f.actor,{key:'statement'})).assessment,null);await assert.rejects(f.memory.assess(f.reviewer,{...judgment,expectedRevision:3}),{statusCode:409});
}));
