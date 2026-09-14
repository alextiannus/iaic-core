import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {PeerReviews,WorkspaceReviewStore,createPeerReviewCapabilities,CapabilityDispatcher,PostgresWorkspaceStore,AssistantWorkspace,AgentRuntime,TaskStore,ContextAssembler,defineCapability} from '@immedi/iaic-core';
import {createCapabilityMcpServer} from '@immedi/iaic-core/mcp/server.js';

const connectionString=process.env.DATABASE_URL||process.env.SUBMISSION_TEST_DATABASE_URL;
if(!connectionString)throw new Error('Isolated PostgreSQL URL required');
const admin=new Pool({connectionString}),schema='peer_demo_'+randomUUID().replaceAll('-','');
await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
let runtime,client,server;
try{
 const builtin={scopeId:'peer-demo',subjectId:'builtin-platform'},external={scopeId:'peer-demo',subjectId:'external-platform'},service={scopeId:'peer-demo',subjectId:'evidence-service'};
 // Trusted fixture membership, not a model-selected principal or shared login.
 const members=new Set([builtin.subjectId,external.subjectId]);
 const store=new PostgresWorkspaceStore({pool});await store.initialize();
 const workspace=new AssistantWorkspace({store,resolveScope:async actor=>{
  if(!members.has(actor.subjectId))throw Object.assign(new Error('Denied'),{statusCode:403});
  return {applicationId:'peer-demo',assistantId:'platform-team',subjectId:'shared-work'};
 },sourceFor:actor=>({kind:'platform-work',author:actor.subjectId})});
 const evidence=new AssistantWorkspace({store,resolveScope:async actor=>{
  assert.equal(actor,service);return {applicationId:'peer-demo',assistantId:'platform-team',subjectId:'reserved-evidence'};
 },sourceFor:()=>({kind:'review-service'})});
 const reviews=new PeerReviews({store:new WorkspaceReviewStore({workspace:evidence,actor:service}),resolvePrincipal:actor=>actor.subjectId,authorize:actor=>members.has(actor.subjectId),readArtifact:async(actor,reference)=>{
  const artifact=await workspace.read(actor,reference);return {reference:artifact.reference,author:artifact.source.author};
 }});
 const externalWork=await workspace.write(external,{path:'external-change.md',content:'A proposed platform change that needs a failure test.',expectedRevision:0});
 const nativeWork=await workspace.write(builtin,{path:'native-plan.md',content:'A platform maintenance plan that needs execution evidence.',expectedRevision:0});
 const plannedReview={id:'native-review',target:externalWork.reference,verdict:'changes_requested',findings:'Add evidence for the failure path.'};
 const capabilities=createPeerReviewCapabilities({reviews});
 const job=defineCapability({name:'platform.review',description:'Retain a peer review of a platform artifact.',input:{type:'object',properties:{goal:{type:'string'}},required:['goal'],additionalProperties:false},output:{type:'object',properties:{reviewId:{type:'string'}},required:['reviewId'],additionalProperties:false},effect:'write',retry:'never-replay',authorize:actor=>actor.subjectId===builtin.subjectId,implementation:{kind:'agent',instructions:'Record peer findings, then read back the original review before finishing.',tools:capabilities.map(c=>c.name),verify:async(_input,result,{history})=>result.reviewId===plannedReview.id&&(await reviews.read(builtin,result.reviewId)).reviewer===builtin.subjectId&&history.calls.some(c=>c.capability==='collaboration.reviews.read'&&c.status==='succeeded')}});
 const dispatcher=new CapabilityDispatcher({capabilities:[...capabilities,job]});let step=0;
 // This fixture verifies integration, not semantic quality or live Codex behavior.
 const model={name:'deterministic-platform-review',next:async()=>{
  if(step++===0)return {type:'call',name:'collaboration.reviews.record',input:plannedReview};
  if(step===2)return {type:'call',name:'collaboration.reviews.read',input:{id:plannedReview.id}};
  return {type:'finish',result:{reviewId:plannedReview.id}};
 }};
 runtime=new AgentRuntime({store:new TaskStore({pool}),dispatcher,model,context:new ContextAssembler({skillRoot:process.cwd()}),version:'peer-demo-v1'});dispatcher.tasks=runtime;await runtime.initialize();
 const task=await dispatcher.invoke(job.name,{goal:'Review the external change and retain your findings.'},{actor:builtin,callId:'native-review-task'});
 assert.equal((await runtime.tick()).status,'succeeded');
 server=createCapabilityMcpServer({dispatcher,resolveAccess:async()=>({actor:external,capabilities:capabilities.map(c=>c.name)})});
 client=new Client({name:'external-platform-fixture',version:'1'});
 const [ct,st]=InMemoryTransport.createLinkedPair();await server.connect(st);await client.connect(ct);
 const call=async(name,input,requestKey)=>{
  const result=await client.callTool({name,arguments:{input,...(requestKey?{requestKey}:{})}});
  assert.notEqual(result.isError,true,JSON.stringify(result));return JSON.parse(result.content[0].text);
 };
 assert.equal((await call('collaboration.reviews.read',{id:plannedReview.id})).author,external.subjectId);
 const reverse=await call('collaboration.reviews.record',{id:'external-review',target:nativeWork.reference,verdict:'inconclusive',findings:'Run the plan and attach results before drawing conclusions.'},'external-review-call');
 assert.equal(reverse.reviewer,external.subjectId);assert.equal(reverse.author,builtin.subjectId);
 assert.equal((await reviews.read(builtin,reverse.id)).verdict,'inconclusive');
 assert.equal((await runtime.state(builtin,task.id)).status,'succeeded');
 console.log(JSON.stringify({application:'core-peer-reviews',persistentNativeReview:true,externalMcpReview:true,reciprocalReview:true,sharedEvidence:true,separatePrincipals:true,modelMode:'deterministic',liveCodex:false,taskTakeover:false}));
}finally{await client?.close();await server?.close();await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
