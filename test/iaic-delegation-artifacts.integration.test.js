import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {PostgresWorkspaceStore,AssistantWorkspace,PostgresDelegationStore,DelegatedCapabilities,DelegationArtifacts,CapabilityDispatcher,createDelegationArtifactCapabilities} from '@immedi/iaic-core';
async function fixture(fn){const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');const schema='share_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});try{
 const owner={subjectId:'issuer'},worker={subjectId:'delegate'},scope=a=>({applicationId:'app',subjectId:a.subjectId,assistantId:'job'}),ws=new PostgresWorkspaceStore({pool});await ws.initialize();const workspace=new AssistantWorkspace({store:ws,resolveScope:scope,sourceFor:()=>({kind:'fixture'})});
 const original=await workspace.write(owner,{path:'input.md',content:'Approved source',mediaType:'text/markdown'}),output=await workspace.write(worker,{path:'output.md',content:'Verified output',mediaType:'text/markdown'});
 const store=new PostgresDelegationStore({pool,namespace:'fixture'});await store.initialize();
 const dispatcher=new CapabilityDispatcher({capabilities:[]}),principal=a=>({applicationId:'app',subjectId:a.subjectId});let allowed=true,gets=0;
 const grants=new DelegatedCapabilities({store,dispatcher,resolvePrincipal:principal,restoreActor:r=>({subjectId:r.subjectId}),authorizeGrant:()=>true,allowInput:()=>true});
 const grant=await grants.issue(owner,{id:'work',delegate:principal(worker),payer:principal(owner),tools:['work'],constraints:{},deadlineAt:new Date(Date.now()+60000).toISOString(),maxCalls:5,artifacts:[original.reference],task:{capability:'worker.run',input:{},budgetId:'budget'}});
 const task={id:randomUUID(),authority:{grantId:'work',digest:grant.digest},status:'succeeded',result:{summary:'Prepared the output',artifacts:[output.reference]}};
 // The Task port is a fixture; source storage and immutable grant are real PostgreSQL.
 dispatcher.tasks={store:{findRequest:async()=>task},get:async()=>{gets++;return task;}};
 const artifacts=new DelegationArtifacts({grants,readOwned:(a,r)=>workspace.read(a,r),authorizeShare:()=>allowed});
 await fn({owner,worker,workspace,original,output,task,grants,artifacts,store,pool,deny:()=>{allowed=false;},gets:()=>gets,scope});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}}
test('Shared references retain original ownership and revision without copying artifacts',async()=>fixture(async f=>{
 const entry=await f.artifacts.read(f.worker,{grantId:'work',owner:'issuer',reference:f.original.reference});assert.equal(entry.content,'Approved source');assert.equal(entry.source,undefined);
 await f.workspace.write(f.owner,{path:'input.md',content:'Later version',mediaType:'text/markdown',expectedRevision:1});
 assert.equal((await f.artifacts.read(f.worker,{grantId:'work',owner:'issuer',reference:f.original.reference})).content,'Approved source');
 const projected=await f.artifacts.result(f.owner,'work');assert.deepEqual(projected.result.artifacts,[f.output.reference]);assert.equal(projected.history,undefined);assert.equal(f.gets(),1);
 await assert.rejects(f.workspace.read(f.worker,f.original.reference));
}));
test('Shared Capability revalidation removes access after current sharing policy or grant revocation',async()=>fixture(async f=>{
 const dispatcher=new CapabilityDispatcher({capabilities:createDelegationArtifactCapabilities({artifacts:f.artifacts})}),input={grantId:'work',owner:'issuer',reference:f.original.reference};
 const result=await dispatcher.invoke('collaboration.artifact.read',input,{actor:f.worker});f.deny();
 await assert.rejects(dispatcher.capabilities.get('collaboration.artifact.read').revalidate(input,result,{actor:f.worker}),{statusCode:403});
 f.task.result.artifacts=[];await assert.rejects(f.artifacts.result(f.owner,'work'),{statusCode:403});
 await f.grants.revoke(f.owner,'work');await assert.rejects(f.artifacts.read(f.worker,input),{statusCode:403});
}));
test('Unbound, deleted or corrupted artifacts cannot be presented as shared results',async()=>fixture(async f=>{
 await assert.rejects(f.artifacts.read({subjectId:'other'},{grantId:'work',owner:'issuer',reference:f.original.reference}),{statusCode:403});
 await assert.rejects(f.artifacts.read(f.worker,{grantId:'work',owner:'issuer',reference:f.output.reference}),{statusCode:403});
 await f.pool.query("UPDATE iaic_workspace_versions SET content='corrupt' WHERE path='output.md'");await assert.rejects(f.artifacts.result(f.owner,'work'),{statusCode:409});
 await f.workspace.remove(f.owner,{path:'input.md',expectedRevision:1});await assert.rejects(f.artifacts.read(f.worker,{grantId:'work',owner:'issuer',reference:f.original.reference}));
}));
