import test from 'node:test';
import assert from 'node:assert/strict';
import {AssistantModelRouting} from '@immedi/iaic-core';
import {AssistantModels} from '@immedi/iaic-core/assistants/models.js';
function fixture(){
 let selected='primary',allowed=['primary','backup'],primaryAvailable=false,unknown=false,revoked=false,error=null;
 const calls=[],charges=[];
 const profiles={list:()=>['primary','backup'].map(id=>({id,modelIdentity:id+':v1',model:id})),resolve:async(id)=>({name:id+':v1',model:id,profileId:id,next:async()=>{calls.push(id);if(error)throw error;return {type:'wait',question:'Ready',usage:{inputTokens:2,outputTokens:1}};}})};
 const ledger={hasPendingTask:async()=>false,reserve:async(_scope,r)=>{charges.push({kind:'reserve',profile:r.attribution.profile});},settle:async()=>({receipt:{id:'settled',delta:'3'}}),markUnknown:async()=>charges.push({kind:'unknown'}),release:async()=>charges.push({kind:'released'})};
 const models=new AssistantModels({profiles,settings:{get:async()=>({model_profile:selected})},resolveScope:async()=>({subjectId:'owner'}),ledger,tokenPolicies:Object.fromEntries(['primary','backup'].map(id=>[id,{maximum:10,price:{revision:'v1',input:1,cachedInput:1,output:1}}]))});
 const config={models,resolvePolicy:async()=>revoked?null:{revision:'policy-v1',profileIds:allowed},availability:async({profile})=>unknown?'unknown':profile.id==='primary'&&!primaryAvailable?'unavailable':'available'};
 return {models,config,calls,charges,router:()=>new AssistantModelRouting(config),select:value=>selected=value,allow:value=>allowed=value,available:()=>primaryAvailable=true,unknown:()=>unknown=true,revoke:()=>revoked=true,error:value=>error=value};
}
const req={billingContext:{taskId:'task',turn:1}};
test('routing selects explicit available backup, meters its identity and pins it after reconstruction',async()=>{
 const f=fixture(),model=await f.router().resolve({actor:{}});assert.equal(model.name,'backup:v1');
 await model.next(req);assert.deepEqual(f.calls,['backup']);assert.deepEqual(f.charges,[{kind:'reserve',profile:'backup'}]);
 f.available();const resumed=await f.router().resolve({actor:{},modelIdentity:model.name});assert.equal(resumed.name,'backup:v1');
 assert.equal((await f.router().resolve({actor:{}})).name,'primary:v1');
 f.select('backup');await assert.rejects(f.router().resolve({actor:{}}),/start with the selected/);
 assert.equal((await f.router().resolve({actor:{},modelIdentity:model.name})).name,'backup:v1');
});
test('unknown availability and current policy revocation stop before provider and billing',async()=>{
 const f=fixture();f.unknown();await assert.rejects(f.router().resolve({actor:{}}),/availability is unknown/);assert.equal(f.charges.length,0);
 const g=fixture(),model=await g.router().resolve({actor:{}});g.revoke();await assert.rejects(model.next(req),{statusCode:403});assert.equal(g.calls.length,0);assert.equal(g.charges.length,0);
});
test('provider uncertainty retains original metered unknown and never calls fallback',async()=>{
 const f=fixture();f.available();const model=await f.router().resolve({actor:{}});f.error(new Error('response lost'));
 await assert.rejects(model.next(req),{code:'USAGE_RECONCILIATION_REQUIRED'});assert.deepEqual(f.calls,['primary']);assert.deepEqual(f.charges,[{kind:'reserve',profile:'primary'},{kind:'unknown'}]);
});
test('mixed credential routes, removed pinned profiles, and identity races reject',async()=>{
 const f=fixture();const snapshot=f.models.snapshot.bind(f.models);f.models.snapshot=async a=>{const s=await snapshot(a);s.profiles[1].credentialMode='BYOK';return s;};
 await assert.rejects(f.router().resolve({actor:{}}),/credential mode/);
 const g=fixture();g.allow(['primary']);await assert.rejects(g.router().resolve({actor:{},modelIdentity:'backup:v1'}),{statusCode:403});
 const h=fixture();h.models.target=async()=>({name:'backup:v2'});await assert.rejects(h.router().resolve({actor:{}}),/changed during routing/);
});
test('allowance exhaustion and explicit provider preflight rejection never change the route',async()=>{
 const f=fixture();f.available();f.models.ledger.reserve=async()=>{throw Object.assign(new Error('Allowance exhausted'),{code:'ALLOWANCE_EXHAUSTED'});};
 await assert.rejects((await f.router().resolve({actor:{}})).next(req),{code:'ALLOWANCE_EXHAUSTED'});assert.equal(f.calls.length,0);
 const g=fixture();g.available();g.error(Object.assign(new Error('Capacity full'),{providerNotCalled:true}));
 await assert.rejects((await g.router().resolve({actor:{}})).next(req),/Capacity full/);assert.deepEqual(g.calls,['primary']);assert.equal(g.charges.at(-1).kind,'released');
});
