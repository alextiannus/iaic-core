import test from 'node:test';import assert from 'node:assert/strict';
import {AssistantModels} from '@immedi/iaic-core/assistants/models.js';
test('headless model module supports a non-ERP actor, pinned tasks and zero-debit BYOK without fallback',async()=>{
 const owner={uid:'person'},scope={applicationId:'independent-app',assistantId:'assistant',subjectId:'person'};let saved=null,revoked=false,systemCalls=0,ownCalls=0;const settlements=[];
 const settings={get:async s=>{assert.equal(s,scope);return saved;},select:async(s,id,revision)=>{assert.equal(s,scope);if(revision!==(saved?.revision||0))throw Object.assign(new Error('Stale'),{statusCode:409});return saved={model_profile:id,revision:revision+1};}};
 const profiles={list:()=>[{id:'system',label:'System',model:'model',modelIdentity:'system:v1'}],resolve:async id=>{assert.equal(id,'system');return {name:'system:v1',profileId:'system',next:async()=>{systemCalls++;}};}};
 const userModels={endpoints:()=>[],list:async()=>revoked?[]:[{id:'byok-own',model:'own',modelIdentity:'byok-own:v1',credentialMode:'BYOK'}],resolve:async()=>{if(revoked)throw Object.assign(new Error('Revoked'),{statusCode:409});return {name:'byok-own:v1',profileId:'byok-own',credentialMode:'BYOK',next:async()=>{ownCalls++;return {type:'wait',question:'Next?',usage:{inputTokens:5,outputTokens:2}};}};}};
 const ledger={hasPendingTask:async()=>false,reserve:async(s,input)=>{assert.equal(s,scope);assert.equal(input.mode,'BYOK');assert.equal(input.maximum,0);},settle:async(s,input)=>{settlements.push(input);return {receipt:{id:'1',delta:'0'}};}};
 const module=new AssistantModels({settings,profiles,userModels,ledger,tokenPolicies:{system:{maximum:100,price:{revision:"test",input:2,cachedInput:1,output:3}}},resolveScope:async actor=>{if(actor!==owner)throw Object.assign(new Error('Denied'),{statusCode:403});return scope;}});
 assert.equal((await module.snapshot(owner)).selectedProfile,'system');
 await module.select(owner,{profileId:'byok-own',expectedRevision:0});
 assert.equal((await module.resolve({actor:owner,modelIdentity:'system:v1'})).name,'system:v1');
 const own=await module.resolve({actor:owner});await own.next({billingContext:{taskId:'independent-task',turn:1}});assert.equal(ownCalls,1);assert.equal(systemCalls,0);assert.equal(settlements[0].usage.input_tokens,5);
 revoked=true;await assert.rejects(module.resolve({actor:owner}),{statusCode:409});assert.equal(systemCalls,0);
 await assert.rejects(module.snapshot({uid:'other'}),{statusCode:403});
});
test('trusted billing resolver binds payer and executor without moving settings or permitting request spoofing',async()=>{
 const owner={uid:'p'},personal={applicationId:'app',subjectId:'p'},payer={applicationId:'app',subjectId:'usd-p'};let seen,admitted,denied=false,pending=false;
 const provider={name:'pinned',model:'m',profileId:'s',next:async()=>({type:'wait',question:'Next',usage:{inputTokens:1,outputTokens:1}})};
 const ledger={hasPendingTask:async()=>false,reserve:async(scope,call)=>{admitted={scope,call};},settle:async()=>({receipt:{id:'1',delta:'-3'}})};
 const models=new AssistantModels({settings:{get:async scope=>{assert.equal(scope,personal);return null;}},profiles:{list:()=>[{id:'s',modelIdentity:'pinned'}],resolve:async()=>provider},ledger,resolveScope:async()=>personal,resolveBilling:async ctx=>{if(denied)throw Error('Not approved');seen=ctx;return {scope:payer,executorId:'trusted-worker',beforeCall:async()=>{if(pending)throw Error('Old payer unresolved');},policy:{maximum:10,price:{revision:'usd',input:1,cachedInput:1,output:2}}};}});
 const agent={definitionId:'worker'},model=await models.resolve({actor:owner,agent,modelIdentity:'pinned'});assert.equal(seen.actor,owner);assert.equal(seen.agent,agent);assert.deepEqual(Object.keys(seen.model).sort(),['model','name','profileId']);
 await model.next({billingContext:{taskId:'task',turn:1,executorId:'spoof'}});assert.equal(admitted.scope,payer);assert.equal(admitted.call.attribution.executorId,'trusted-worker');
 pending=true;admitted=null;await assert.rejects(model.next({billingContext:{taskId:'old',turn:2}}),/Old payer unresolved/);assert.equal(admitted,null);
 denied=true;await assert.rejects(models.resolve({actor:owner}),/Not approved/);await assert.rejects(models.target(owner,'s'),/Not approved/);
});
