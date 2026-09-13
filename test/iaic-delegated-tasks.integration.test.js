import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {PostgresWorkspaceStore,AssistantWorkspace,DelegationArtifacts,DelegationParents,TaskStore,AgentRuntime,ContextAssembler,CapabilityDispatcher,defineCapability,TokenLedger,AllowanceBudgets,PostgresDelegationStore,DelegatedCapabilities,DelegatedTasks,delegationExecutorKey} from '@immedi/iaic-core';
async function fixture(fn){
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');const schema='delegated_task_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let runtime;
 try{
  await pool.query('CREATE TABLE effects(id text PRIMARY KEY,owner text)');
  const workspaceStore=new PostgresWorkspaceStore({pool});await workspaceStore.initialize();
  const workspace=new AssistantWorkspace({store:workspaceStore,resolveScope:a=>({applicationId:a.scopeId,subjectId:a.subjectId,assistantId:'fixture-job'}),sourceFor:()=>({kind:'fixture-task'})});let outputArtifact=null;
  const issuer={scopeId:'app',subjectId:'issuer'},delegate={scopeId:'app',subjectId:'delegate'},principal=a=>({applicationId:a.scopeId,subjectId:a.subjectId}),permitted=new Set(['issuer','delegate']);
  const ledger=new TokenLedger({pool});await ledger.initialize();const budgets=new AllowanceBudgets({ledger});ledger.budgets=budgets;await budgets.initialize();await ledger.grant(principal(issuer),{reference:'initial',amount:100,evidence:{fixture:true}});
  await budgets.create(principal(issuer),{id:'work',maximum:'10',executors:[delegationExecutorKey(principal(delegate))],deadlineAt:new Date(Date.now()+60000).toISOString(),overflow:'platform_absorbs'});
  const object={type:'object'},cap=defineCapability({name:'records.write',description:'Fixture effect',input:object,output:object,effect:'write',retry:'never-replay',authorize:a=>permitted.has(a.subjectId),revalidate:async(_i,r)=>r,implementation:{kind:'function',execute:async(i,c)=>{await pool.query('INSERT INTO effects VALUES($1,$2)',[c.callId,c.actor.subjectId]);outputArtifact=await workspace.write(c.actor,{path:'output.md',content:'Verified delegated output',mediaType:'text/markdown'});return {done:true};}}});
  const agent=defineCapability({name:'worker.run',description:'Fixture worker',input:object,output:object,effect:'write',retry:'never-replay',authorize:a=>permitted.has(a.subjectId),implementation:{kind:'agent',instructions:'Write once then finish',tools:['records.write'],verify:async()=>Number((await pool.query('SELECT count(*) FROM effects')).rows[0].count)===1}});
  const dispatcher=new CapabilityDispatcher({capabilities:[cap,agent]}),grantStore=new PostgresDelegationStore({pool,namespace:'fixture'});await grantStore.initialize();
  const grants=new DelegatedCapabilities({store:grantStore,dispatcher,resolvePrincipal:principal,restoreActor:r=>({scopeId:r.applicationId,subjectId:r.subjectId}),authorizeGrant:()=>true,allowInput:()=>true});
  const authority=new DelegatedTasks({grants,ledger,modelPolicy:()=>({mode:'SYSTEM_MANAGED',policy:{maximum:'5',price:{revision:'fixture',input:'1',cachedInput:'1',output:'1'}}})});
  const input={goal:'Write the fixture record and verify it',allowedTools:['records.write']};
  await grants.issue(issuer,{id:'task-grant',delegate:principal(delegate),payer:principal(issuer),tools:['records.write'],constraints:{},deadlineAt:new Date(Date.now()+60000).toISOString(),maxCalls:1,task:{capability:agent.name,input,budgetId:'work'}});
  let modelCalls=0;const model={name:'fixture-model',next:async r=>{modelCalls++;if(r.billingContext.capability==='parent.run')return {type:'wait',question:'Delegate the scoped work',usage:{inputTokens:1,outputTokens:1}};return {...(!outputArtifact?{type:'call',name:'records.write',input:{}}:{type:'finish',result:{done:true,summary:'Produced an artifact',artifacts:outputArtifact?[outputArtifact.reference]:[]}}),usage:{inputTokens:1,outputTokens:1}};}};
  const build=async(enabled=true)=>{if(runtime)await runtime.stop();runtime=new AgentRuntime({store:new TaskStore({pool}),dispatcher,model,authority:enabled?authority:null,context:new ContextAssembler({skillRoot:'/tmp'}),version:'fixture-v1'});dispatcher.tasks=runtime;await runtime.initialize();return runtime;};
  await build();await fn({issuer,delegate,authority,grants,grantStore,dispatcher,workspace,ledger,budgets,principal,pool,build,permitted,modelCalls:()=>modelCalls,getRuntime:()=>runtime});
 }finally{if(runtime)await runtime.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
test('Delegated persistent Task survives Runtime reconstruction and charges its explicit shared payer budget',async()=>fixture(async f=>{
 const task=await f.authority.submit(f.delegate,'task-grant');assert.equal((await f.authority.submit(f.delegate,'task-grant')).id,task.id);assert.equal(task.authority.grantId,'task-grant');
 const runtime=await f.build();const done=await runtime.tick();assert.equal(done.status,'succeeded',done.error);assert.equal(done.id,task.id);
 assert.equal((await f.pool.query('SELECT owner FROM effects')).rows[0].owner,'delegate');assert.equal((await f.budgets.read(f.principal(f.issuer),'work')).spent,'4');assert.equal((await f.ledger.balance(f.principal(f.delegate))).balance,'0');
 const history=await runtime.store.history(f.delegate,task.id),grant=await f.grants.read(f.issuer,'task-grant');assert.equal(grant.calls[0].effect_key,history.calls[0].id);assert.equal(grant.calls[0].outcome,'returned');
}));
test('Bound Tasks fail closed without resolver and resume with the original authority',async()=>fixture(async f=>{
 const task=await f.authority.submit(f.delegate,'task-grant');let runtime=await f.build(false);const waiting=await runtime.tick();assert.equal(waiting.status,'waiting');assert.match(waiting.error,/authority resolver/);assert.equal(f.modelCalls(),0);
 runtime=await f.build();await runtime.transition(f.delegate,task.id,{action:'resume'});assert.equal((await runtime.tick()).status,'succeeded');
}));
test('Issuer can revoke and cancel the bound Task after executor permission is removed',async()=>fixture(async f=>{
 const task=await f.authority.submit(f.delegate,'task-grant');f.permitted.delete('delegate');const cancelled=await f.authority.cancel(f.issuer,'task-grant');assert.equal(cancelled.taskId,task.id);assert.equal(cancelled.status,'cancelled');
 assert.equal(await f.getRuntime().tick(),null);assert.equal(f.modelCalls(),0);assert.equal((await f.grants.read(f.issuer,'task-grant')).revoked,true);
}));

test('Delegated result polling cannot bypass the grant call ceiling',async()=>fixture(async f=>{
 let reads=0;f.dispatcher.capabilities.set('records.write',defineCapability({name:'records.write',description:'Read waiting source',input:{type:'object'},output:{type:'object'},effect:'read',authorize:()=>true,revalidate:async(_i,r)=>r,waitReady:async()=>false,implementation:{kind:'function',execute:async()=>{reads++;return {ready:false};}}}));
 await f.authority.submit(f.delegate,'task-grant');const runtime=f.getRuntime();const waiting=await runtime.tick();assert.equal(waiting.status,'waiting');assert.equal(reads,1);
 runtime.resultWaits.nextCheck=0;await runtime.tick();assert.equal(reads,1);assert.equal((await f.grants.read(f.issuer,'task-grant')).calls.length,1);
}));

test('Issuer reads exact artifacts from the completed cross-principal Runtime Task',async()=>fixture(async f=>{
 const task=await f.authority.submit(f.delegate,'task-grant');await f.getRuntime().tick();
 const shares=new DelegationArtifacts({grants:f.grants,readOwned:(a,r)=>f.workspace.read(a,r),authorizeShare:()=>true});
 const result=await shares.result(f.issuer,'task-grant');assert.equal(result.taskId,task.id);assert.equal(result.status,'succeeded');assert.equal(result.result.artifacts.length,1);
 const ref=result.result.artifacts[0];await assert.rejects(f.workspace.read(f.issuer,ref));
 const content=await shares.read(f.issuer,{grantId:'task-grant',owner:'delegate',reference:ref});assert.equal(content.content,'Verified delegated output');assert.deepEqual(content.reference,ref);
}));
test('Runtime reconstruction reconciles revocation committed before Task cancellation',async()=>fixture(async f=>{
 const task=await f.authority.submit(f.delegate,'task-grant');await f.grantStore.revoke('task-grant');
 const runtime=await f.build();assert.equal(await runtime.tick(),null);assert.equal((await runtime.store.get(f.delegate,task.id)).status,'cancelled');assert.equal(f.modelCalls(),0);
 await runtime.tick();assert.equal((await runtime.store.get(f.delegate,task.id)).status,'cancelled');
}));
test('Cancellation sweep preserves completed results and supports bounded grant pages',async()=>fixture(async f=>{
 const task=await f.authority.submit(f.delegate,'task-grant');await f.getRuntime().tick();await f.grantStore.revoke('task-grant');
 await f.authority.tick();assert.equal((await f.getRuntime().store.get(f.delegate,task.id)).status,'succeeded');
 const entries=await f.grantStore.taskPage({limit:1});assert.deepEqual(entries,['task-grant']);assert.deepEqual(await f.grantStore.taskPage({after:'task-grant'}),[]);
}));

test('Late Task admission after a revocation sweep is cancelled on the next tick',async()=>fixture(async f=>{
 const store=f.getRuntime().store,original=store.create.bind(store);let release,entered;
 const admitted=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
 store.create=async args=>{entered();await gate;return original(args);};
 const pending=f.authority.submit(f.delegate,'task-grant');
 try{await admitted;await f.grantStore.revoke('task-grant');await f.authority.tick();release();const task=await pending;
  assert.equal(task.status,'queued');await f.getRuntime().tick();assert.equal((await store.get(f.delegate,task.id)).status,'cancelled');assert.equal(f.modelCalls(),0);
 }finally{release();store.create=original;}
}));
test('Expired unfinished delegation is cancelled while its original grant evidence is retained',async()=>fixture(async f=>{
 const prior=await f.grantStore.get('task-grant');await f.grants.issue(f.issuer,{...prior.terms,id:'expiring',deadlineAt:new Date(Date.now()+3000).toISOString()});
 const task=await f.authority.submit(f.delegate,'expiring');await new Promise(r=>setTimeout(r,3100));
 await f.getRuntime().tick();assert.equal((await f.getRuntime().store.get(f.delegate,task.id)).status,'cancelled');assert.equal((await f.grantStore.get('expiring')).revoked,false);assert.equal(f.modelCalls(),0);
}));

async function linkedParent(f,{allowCall=()=>true}={}){
 const cap=defineCapability({name:'parent.run',description:'Parent work',input:{type:'object'},output:{type:'object'},effect:'read',authorize:a=>f.permitted.has(a.subjectId),implementation:{kind:'agent',instructions:'Wait for scoped delegated work',tools:['records.write'],allowCall,verify:async()=>true}});
 f.dispatcher.capabilities.set(cap.name,cap);
 const runtime=f.getRuntime();await runtime.create({capability:cap,input:{goal:'Parent goal',allowedTools:['records.write']},actor:f.issuer,idempotencyKey:'parent'});const parent=await runtime.tick();assert.equal(parent.waiting_reason,'input');
 const prior=await f.grantStore.get('task-grant');await f.grants.issue(f.issuer,{...prior.terms,id:'linked',task:{...prior.terms.task,parent:{taskId:parent.id,version:parent.version,waitingSeq:(await runtime.store.controlState(f.issuer,parent.id)).controlSeq}}});
 f.authority.parents=new DelegationParents({grants:f.grants,allowLink:()=>true});return parent;
}
test('Child grant is pinned to the owned parent waiting receipt and domain restrictions',async()=>fixture(async f=>{
 let allowed=false;const parent=await linkedParent(f,{allowCall:()=>allowed});await f.authority.submit(f.delegate,'linked');
 const waiting=await f.getRuntime().tick();assert.equal(waiting.status,'waiting');assert.match(waiting.error,/parent domain restrictions/);assert.equal((await f.pool.query('SELECT * FROM effects')).rowCount,0);
 allowed=true;await f.getRuntime().transition(f.delegate,waiting.id,{action:'resume'});assert.equal((await f.getRuntime().tick()).status,'succeeded');assert.equal((await f.getRuntime().store.get(f.issuer,parent.id)).status,'waiting');
}));
test('Parent cancellation propagates to its child and a missing parent resolver fails closed',async()=>fixture(async f=>{
 const parent=await linkedParent(f);const resolver=f.authority.parents;f.authority.parents=null;await assert.rejects(f.authority.submit(f.delegate,'linked'),{statusCode:503});f.authority.parents=resolver;
 const child=await f.authority.submit(f.delegate,'linked');await f.getRuntime().transition(f.issuer,parent.id,{action:'cancel'});await f.getRuntime().tick();assert.equal((await f.getRuntime().store.get(f.delegate,child.id)).status,'cancelled');assert.equal(f.modelCalls(),1);
}));
test('A later parent waiting episode cannot revive a grant bound to an earlier wait',async()=>fixture(async f=>{
 const parent=await linkedParent(f);await f.getRuntime().transition(f.issuer,parent.id,{action:'provide_input',input:'Continue planning'});await f.getRuntime().tick();
 await f.pool.query('UPDATE iaic_tasks SET updated_at=$2 WHERE id=$1',[parent.id,parent.updated_at]);
 await assert.rejects(f.authority.submit(f.delegate,'linked'),{statusCode:403});
}));
