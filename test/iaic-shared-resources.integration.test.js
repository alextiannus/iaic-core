import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {PostgresAccountStore,AccountDirectory,DirectoryResourceScopes,MemoryStore,AssistantMemory,PostgresWorkspaceStore,AssistantWorkspace} from '@immedi/iaic-core';
async function fixture(fn){
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');const schema='shared_resources_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
 try{
  const accounts=new PostgresAccountStore({pool,namespace:'fixture'}),memories=new MemoryStore({pool}),documents=new PostgresWorkspaceStore({pool});for(const s of [accounts,memories,documents])await s.initialize();
  for(const id of ['alice','bob'])await accounts.put('account',id,{expectedRevision:0});for(const id of ['one','two'])await accounts.put('organization',id,{expectedRevision:0});
  for(const organizationId of ['one','two'])for(const accountId of ['alice','bob'])await accounts.putMembership(organizationId,accountId,{expectedRevision:0,roles:[accountId==='alice'?'editor':'reader']});
  const directory=new AccountDirectory({store:accounts,namespace:'fixture',resolveIdentity:c=>c,authorize:()=>false});
  const alice=await directory.actor({accountId:'alice',organizationId:'one'}),bob=await directory.actor({accountId:'bob',organizationId:'one'}),foreign=await directory.actor({accountId:'alice',organizationId:'two'});
  const scopes=new DirectoryResourceScopes({applicationId:'fixture',directory,authorize:({current,owner,access})=>owner==='personal'||access==='read'||current.membership.roles.includes('editor')});
  const compose=owner=>{const resolveScope=scopes.resolver({owner,resourceId:'team-assistant'}),sourceFor=a=>({kind:'user-request',actor:a.subjectId});return {memory:new AssistantMemory({store:memories,resolveScope,sourceFor}),workspace:new AssistantWorkspace({store:documents,resolveScope,sourceFor})};};
  await fn({accounts,alice,bob,foreign,scopes,compose,...compose('organization')});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
test('Members share original Memory and Artifact revisions while read-only roles cannot mutate them',async()=>fixture(async f=>{
 await f.memory.remember(f.alice,{key:'guide',kind:'note',content:'Shared source',expectedRevision:0});const artifact=await f.workspace.write(f.alice,{path:'guide.md',content:'Shared draft',expectedRevision:0});
 assert.equal((await f.memory.read(f.bob,{key:'guide'})).content,'Shared source');assert.equal((await f.workspace.read(f.bob,artifact.reference)).content,'Shared draft');
 await assert.rejects(f.memory.remember(f.bob,{key:'guide',kind:'note',content:'Changed',expectedRevision:1}),{statusCode:403});await assert.rejects(f.memory.forget(f.bob,{key:'guide',expectedRevision:1}),{statusCode:403});await assert.rejects(f.workspace.remove(f.bob,{path:'guide.md',expectedRevision:1}),{statusCode:403});
 await f.memory.remember(f.alice,{key:'guide',kind:'note',content:'Corrected',expectedRevision:1});assert.equal((await f.compose('organization').memory.read(f.bob,{key:'guide'})).revision,2);
 await assert.rejects(f.memory.read(f.foreign,{key:'guide'}),{statusCode:404});
}));
test('Revoked membership stops later shared reads, while authorized correction and forgetting propagate',async()=>fixture(async f=>{
 await f.memory.remember(f.alice,{key:'guide',kind:'note',content:'Source',expectedRevision:0});await f.memory.forget(f.alice,{key:'guide',expectedRevision:1});assert.equal((await f.memory.read(f.bob,{key:'guide'})).content,null);
 const artifact=await f.workspace.write(f.alice,{path:'a.md',content:'Source',expectedRevision:0});await f.accounts.putMembership('one','bob',{expectedRevision:1,state:'removed',roles:[]});await assert.rejects(f.workspace.read(f.bob,artifact.reference),{statusCode:403});await assert.rejects(f.memory.list(f.bob),{statusCode:403});
}));
test('Personal partitions remain distinct from other members and organization-owned resources',async()=>fixture(async f=>{
 const personal=f.compose('personal');await personal.memory.remember(f.alice,{key:'private',kind:'note',content:'Only Alice',expectedRevision:0});await assert.rejects(personal.memory.read(f.bob,{key:'private'}),{statusCode:404});await assert.rejects(f.memory.read(f.alice,{key:'private'}),{statusCode:404});
 await assert.rejects(f.scopes.resolver({owner:'organization',resourceId:'team'})(f.alice),{statusCode:400});
}));
