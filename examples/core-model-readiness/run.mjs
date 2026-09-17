import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {withModelReadiness} from '@immedi/iaic-core/agent/model-readiness.js';
import {meteredModel} from '@immedi/iaic-core/billing/metered-model.js';
import {AgentRuntime} from '@immedi/iaic-core/agent/runtime.js';import {TaskStore} from '@immedi/iaic-core/tasks/store.js';import {ContextAssembler} from '@immedi/iaic-core/context/index.js';import {defineCapability,CapabilityDispatcher} from '@immedi/iaic-core/capabilities/index.js';
const binding={modelIdentity:'fixture:original',endpoint:'https://provider.fixture.invalid/v1',credentialRevision:'rotation-1',certificateIdentity:'tls-peer-1'};
const good=()=>({active:true,binding:{...binding},declaredCapabilities:['text_input','tool_calling'],verification:{binding:{...binding},capabilities:['text_input','tool_calling'],tlsVerified:true,verifiedAt:1000,expiresAt:2000}});
let snapshot=good(),time=1500,providerCalls=0,resolves=0;
const model=withModelReadiness({binding,model:{name:binding.modelIdentity,next:async()=>{providerCalls++;return {type:'wait',question:'Fixture confirmation',usage:{inputTokens:2,outputTokens:1}};}},requirements:['tool_calling'],resolve:()=>{resolves++;return structuredClone(snapshot);},now:()=>time});
assert.equal((await model.checkReady()).origin,'https://provider.fixture.invalid');
assert.equal(model.name,binding.modelIdentity);
const cases=[
 [s=>{s.declaredCapabilities=[];},'MODEL_CAPABILITY_MISMATCH'],
 [s=>{s.verification.capabilities=[];},'MODEL_CAPABILITY_MISMATCH'],
 [s=>{s.verification=null;},'MODEL_VERIFICATION_REQUIRED'],
 [s=>{s.verification.expiresAt=1499;},'MODEL_VERIFICATION_EXPIRED'],
 [s=>{s.verification.verifiedAt=1600;},'MODEL_VERIFICATION_REQUIRED'],
 [s=>{s.binding.credentialRevision='rotation-2';},'MODEL_VERIFICATION_STALE'],
 [s=>{s.binding.certificateIdentity='tls-peer-2';},'MODEL_VERIFICATION_STALE'],
 [s=>{s.binding.endpoint='https://new.fixture.invalid/v1';},'MODEL_VERIFICATION_STALE'],
 [s=>{s.binding.endpoint='https://provider.fixture.invalid/v2';},'MODEL_VERIFICATION_STALE'],
 [s=>{s.binding.modelIdentity='another-model';},'MODEL_VERIFICATION_STALE'],
 [s=>{s.binding.endpoint='http://provider.fixture.invalid/v1';},'MODEL_TRANSPORT_INSECURE'],
 [s=>{s.verification.tlsVerified=false;},'MODEL_TRANSPORT_INSECURE'],
 [s=>{s.active=false;},'MODEL_READINESS_REVOKED'],
];
for(const [mutate,code] of cases){snapshot=good();mutate(snapshot);await assert.rejects(model.next({}),{code,providerNotCalled:true});}assert.equal(providerCalls,0);
const failing=withModelReadiness({binding,model:{name:binding.modelIdentity,next:async()=>{throw Error('must not call');}},requirements:[],resolve:()=>{throw Error('PRIVATE-token-and-url');},now:()=>time});
await assert.rejects(failing.checkReady(),e=>e.code==='MODEL_READINESS_UNAVAILABLE'&&!JSON.stringify(e).includes('PRIVATE')&&!e.message.includes('PRIVATE'));
// Existing unknown usage wins; a readiness failure never releases its hold.
let pending=false,reserved=0,released=0,settled=0;
const ledger={hasPendingTask:async()=>pending,reserve:async()=>{reserved++;},release:async()=>{released++;},markUnknown:async()=>{throw Error('unexpected unknown');},settle:async()=>{settled++;return {receipt:{id:'fixture-entry',delta:3}};}};
const metered=meteredModel({model,ledger,scope:{id:'fixture'},policy:{maximum:10,price:{}}});
const request={billingContext:{taskId:'fixture-task',turn:1}};
snapshot=good();snapshot.declaredCapabilities=[];
await assert.rejects(metered.next(request),{code:'MODEL_CAPABILITY_MISMATCH'});assert.equal(reserved,0);assert.equal(released,0);
pending=true;await assert.rejects(metered.next(request),{code:'USAGE_RECONCILIATION_REQUIRED'});assert.equal(released,0);pending=false;
snapshot=good();await metered.next(request);assert.equal(providerCalls,1);assert.equal(reserved,1);assert.equal(settled,1);
// Rotation between reserve and dispatch is rechecked; only this new hold is released.
const changingLedger={...ledger,reserve:async()=>{reserved++;snapshot.binding.credentialRevision='rotated-after-reserve';}};
await assert.rejects(meteredModel({model,ledger:changingLedger,scope:{id:'fixture'},policy:{maximum:10,price:{}}}).next(request),{code:'MODEL_VERIFICATION_STALE'});
assert.equal(providerCalls,1);assert.equal(released,1);
// New evidence permits the same configured model, never a fallback.
snapshot=good();snapshot.binding.credentialRevision='rotation-2';snapshot.verification.binding.credentialRevision='rotation-2';await assert.rejects(model.checkReady(),{code:'MODEL_VERIFICATION_STALE'});
const rebuilt=withModelReadiness({binding:snapshot.binding,model:{name:binding.modelIdentity,next:async()=>({})},requirements:['tool_calling'],resolve:()=>snapshot,now:()=>time});await rebuilt.checkReady();assert.equal(rebuilt.name,binding.modelIdentity);
const url=process.env.DATABASE_URL||process.env.SUBMISSION_TEST_DATABASE_URL;if(!url)throw Error('Isolated PostgreSQL required');
const admin=new Pool({connectionString:url}),schema='readiness_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});let runtime;
try{
 const actor={scopeId:'fixture',subjectId:'owner'},store=new TaskStore({pool});
 const cap=defineCapability({name:'agent.work',description:'Readiness fixture',input:{type:'object'},output:{type:'object'},effect:'read',authorize:()=>true,implementation:{kind:'agent',instructions:'Fixture',tools:[],verify:()=>true}});
 const dispatcher=new CapabilityDispatcher({capabilities:[cap]});
 runtime=new AgentRuntime({store,dispatcher,model:metered,context:new ContextAssembler({}),version:'readiness-v1'});dispatcher.tasks=runtime;await runtime.initialize();
 snapshot=good();snapshot.declaredCapabilities=[];
 await assert.rejects(runtime.create({actor,capability:cap,input:{goal:'Fixture'},idempotencyKey:'rejected'}),{code:'MODEL_CAPABILITY_MISMATCH'});
 assert.equal(Number((await pool.query('SELECT count(*) AS n FROM iaic_tasks')).rows[0].n),0);
 snapshot=good();const task=await runtime.create({actor,capability:cap,input:{goal:'Fixture'},idempotencyKey:'accepted'});
 // Proof expires after admission, before the worker consumes the Task.
 time=2000;const reservesBefore=reserved,callsBefore=providerCalls;
 const paused=await runtime.tick();assert.equal(paused.status,'waiting');assert.equal(paused.waiting_reason,'interrupted');assert.equal(paused.error,'MODEL_VERIFICATION_EXPIRED');assert.equal(reserved,reservesBefore);assert.equal(providerCalls,callsBefore);
 snapshot.verification.verifiedAt=2000;snapshot.verification.expiresAt=3000;
 await runtime.transition(actor,task.id,{action:'resume',requestKey:'fresh-proof'});
 assert.equal((await runtime.tick()).waiting_reason,'input');assert.equal(providerCalls,callsBefore+1);
 console.log(JSON.stringify({modelReadiness:true,bindingExpiryAndCapabilities:true,tlsEvidence:true,resolverErrorsRedacted:true,beforeReserve:true,unknownHoldPreserved:true,postReserveRotation:true,taskAdmission:true,realPostgres:true,realProvider:false,checks:resolves}));
}finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
