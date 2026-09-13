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
