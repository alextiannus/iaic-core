import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {MemoryStore,AssistantMemory,PostgresWorkspaceStore,AssistantWorkspace,WorkspaceLineage} from '@immedi/iaic-core';
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');
const schema='lineage_example_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
try{
 const actor={subjectId:'reader'},scope=a=>({applicationId:'example',assistantId:'helper',subjectId:a.subjectId}),sourceFor=()=>({kind:'example'});
 const memoryStore=new MemoryStore({pool}),workspaceStore=new PostgresWorkspaceStore({pool});await Promise.all([memoryStore.initialize(),workspaceStore.initialize()]);
 const memory=new AssistantMemory({store:memoryStore,resolveScope:scope,sourceFor});let sources=[];
 const build=()=>new AssistantWorkspace({store:workspaceStore,resolveScope:scope,sourceFor,lineage:new WorkspaceLineage({capture:()=>sources,readMemory:(a,r)=>memory.read(a,r),readWorkspace:(a,r)=>workspaceStore.read(scope(a),{path:r.path}),authorizePurge:()=>true})});
 const workspace=build();await memory.remember(actor,{key:'preference',kind:'preference',content:'Fixture source'});const source=await memory.read(actor,{key:'preference'});
 sources=[{kind:'memory',reference:{key:source.key,revision:source.revision}}];const first=await workspace.write(actor,{path:'draft.md',content:'Derived fixture'});
 sources=[{kind:'workspace',reference:first.reference}];const second=await workspace.write(actor,{path:'summary.md',content:'Derived summary'});
 assert.equal((await build().read(actor,second.reference)).content,'Derived summary');await memory.forget(actor,{key:'preference',expectedRevision:1});
 await assert.rejects(build().read(actor,second.reference),{code:'SOURCE_INVALIDATED'});assert.deepEqual((await workspace.list(actor)).items,[]);
 assert.equal((await workspace.purgeInvalid(actor)).removed.length,2);assert.equal((await pool.query('SELECT * FROM iaic_workspace_versions')).rowCount,0);
 console.log(JSON.stringify({example:'core-lineage',status:'passed',transitiveInvalidation:true,ownedDerivedBodiesErased:true,sourceStoresIndependent:true}));
}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
