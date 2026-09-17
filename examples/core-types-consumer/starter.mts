import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {openApplication, type ApplicationOptions, type Application} from '@immedi/iaic-core/developer/templates/agent/app.mjs';
import type {CoreActor} from '@immedi/iaic-core/context/host.js';
import {defineCapability} from '@immedi/iaic-core/capabilities/index.js';

// Compile and run the real installed composition: no ambient shim or source link.
type BusinessActor = CoreActor & {principalId: string; contextRevision: number};
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;
if(!connectionString)throw Error('Strict starter consumer requires an isolated PostgreSQL URL');
const admin=new Pool({connectionString}),schema='typed_starter_'+randomUUID().replaceAll('-','');
await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
const actor:CoreActor={scopeId:'typed-app',subjectId:'owner'};
let app:Application<BusinessActor>|undefined,revoked=false,turn=0,writes=0;
let currentContext='source',contextRevision=1;
const projection={principalId:'trusted-principal'};
const options:ApplicationOptions<BusinessActor>={
 pool,skillRoot:'/tmp',version:'typed-v1',
 job:{id:'assistant',purpose:'Typed Host-backed work',capabilities:['agent.work'],configuration:{skills:[],knowledge:[],tools:['records.write']}},
 profiles:[{id:'system',provider:'openai',model:'fixture',credentialRef:'fixture',invocation:{toolChoice:'required'}}],
 resolveSecret:()=> 'fixture-only',authorize:a=>a.scopeId===actor.scopeId&&a.subjectId===actor.subjectId,
 tokenPolicies:{system:{maximum:100,price:{revision:'v1',input:1,cachedInput:1,output:1}}},
 verifyOutcome:(_input,result,{history})=>result.summary==='done'&&history.calls.some(c=>c.capability==='records.write'&&c.status==='succeeded'),
 hostContext:{
  bind:async()=>({schema:'identity',version:'v1',reference:'source',revision:'1',projection}),
  resolve:async()=>projection,authorize:({binding})=>!revoked&&binding.reference===currentContext,
  restoreActor:async({actor:a})=>({...a,principalId:projection.principalId,contextRevision})
 },
 extraCapabilities:[defineCapability<Record<string,never>,{principalId:string},CoreActor>({
  name:'records.write',description:'Synthetic business operation',input:{type:'object',additionalProperties:false},output:{type:'object'},effect:'write',retry:'never-replay',authorize:()=>!revoked,
  implementation:{kind:'function',execute:async(_input,{actor,taskId})=>{
   assert.ok(taskId);assert.ok(app?.hostContext);
   const business=await app.hostContext.restoreActor({actor,taskId});writes++;
   return {principalId:business.principalId};
  }},
  revalidate:async(_input,previous,{actor,taskId})=>{
   assert.ok(taskId);assert.ok(app?.hostContext);await app.hostContext.restoreActor({actor,taskId});return previous;
  }
 })],
 modelFactory:configuration=>{
  assert.equal(configuration.model,'fixture');
  return {next:async request=>{
   assert.ok(request.messages.some(m=>m.role==='system'&&m.content.includes('trusted-principal')));
   assert.ok(request.tools.every(t=>'inputSchema' in t));
   const usage={inputTokens:1,outputTokens:1};turn++;
   return turn===1?{type:'call',name:'records.write',input:{},usage}:turn===2?{type:'wait',question:'Continue?',usage}:{type:'finish',result:{summary:'done',artifacts:[]},usage};
  }};
 }
};
try{
 app=await openApplication(options);
 const scope=await app.scope(actor);await app.ledger.grant(scope,{reference:'fixture',amount:1000,evidence:{fixture:true}});
 const task=await app.dispatcher.invoke('agent.work',{goal:'Use Host context',allowedTools:['records.write']},{actor,callId:'typed-task'});
 assert.equal((await app.runtime.tick())?.waiting_reason,'input');assert.equal(writes,1);
 assert.equal((await app.runtime.get(actor,task.id)).inputRequest?.question,'Continue?');
 await app.close();app=await openApplication(options);
 assert.ok(app.hostContext);
 contextRevision=2;
 assert.equal((await app.hostContext.restoreActor({actor,taskId:task.id})).principalId,'trusted-principal');
 assert.equal((await app.hostContext.restoreActor({actor,taskId:task.id})).contextRevision,2);
 currentContext='other';await assert.rejects(app.runtime.transition(actor,task.id,{action:'cancel'}),{statusCode:403});currentContext='source';
 await assert.rejects(app.hostContext.restoreActor({actor:{...actor,subjectId:'other'},taskId:task.id}),{statusCode:404});
 revoked=true;await assert.rejects(app.runtime.get(actor,task.id),{statusCode:403});revoked=false;
 await app.runtime.transition(actor,task.id,{action:'provide_input',input:'Continue',requestKey:'typed-input'});
 assert.equal((await app.runtime.tick())?.status,'succeeded');assert.equal(writes,1);
 assert.equal((await app.runtime.get(actor,task.id,{history:true})).calls.length,1);
 assert.equal((await app.ledger.taskUsage(scope,task.id)).complete,true);
 assert.equal((await app.ledger.balance(scope)).reserved,'0');
 assert.equal((await app.runtime.drain()).drained,true);
 if(false){
  // @ts-expect-error Core callback cannot assume rich business identity survives persistence.
  options.authorize=(a:BusinessActor)=>a.principalId==='x';
  // @ts-expect-error No missing Actor subject.
  app.scope({scopeId:'typed-app'});
  // @ts-expect-error Literal agent.work must validate its input, not fall back to unknown.
  app.dispatcher.invoke('agent.work',{goal:3,allowedTools:[]},{actor});
  // @ts-expect-error Runtime input continuation must be text.
  app.runtime.transition(actor,task.id,{action:'provide_input',input:5});
  // @ts-expect-error Model Profile policy is explicit.
  options.profiles[0].invocation={toolChoice:'anything'};
  // @ts-expect-error Unknown raw service handles cannot be used as implicitly any.
  app.memory.remember(actor,{});
 }
 console.log(JSON.stringify({typedStarter:true,postgresTask:true,hostActorRestoration:true,restartAndRevocation:true,contextSwitchAndRevision:true,crossSubjectDenied:true,historyRevalidation:true,writeOnce:true,settledAllowance:true,negativeCompileChecks:6}));
}finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
