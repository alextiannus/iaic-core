import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {AgentRuntime,TaskStore,PostgresWorkspaceStore,AssistantWorkspace,ContextAssembler,CapabilityDispatcher,defineCapability,createModelProvider} from '@immedi/iaic-core';
import {workspaceTools} from '@immedi/iaic-core/workspace/tools.js';
const connectionString=process.env.DATABASE_URL||process.env.SUBMISSION_TEST_DATABASE_URL;
if(!connectionString)throw new Error('Set an isolated PostgreSQL database URL');
const admin=new Pool({connectionString}),schema='core_workspace_'+randomUUID().replaceAll('-','');
await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let runtime;
const actor={scopeId:'workspace-demo',subjectId:'reader'},scope={applicationId:'workspace-demo',assistantId:'helper',subjectId:'reader'};
const content='# Launch checklist\n- Review the draft\n- Confirm the owner';
try{
 const artifacts=new PostgresWorkspaceStore({pool});await artifacts.initialize();
 const authorize=async a=>a.scopeId===actor.scopeId&&a.subjectId===actor.subjectId;
 const workspace=new AssistantWorkspace({store:artifacts,resolveScope:async a=>{if(!await authorize(a))throw new Error('Unauthorized');return scope;},sourceFor:()=>({kind:'user-request',reference:'demo-goal'})});
 const tools=workspaceTools(workspace,actor).filter(t=>['my_write_workspace','my_read_workspace'].includes(t.name));
 const capabilities=tools.map(tool=>defineCapability({name:tool.name,description:tool.description,input:tool.inputSchema,output:{type:'object'},effect:tool.name==='my_write_workspace'?'write':'read',...(tool.name==='my_write_workspace'?{retry:'never-replay'}:{}),authorize,...(tool.preflight?{preflight:tool.preflight}:{}),...(tool.projectHistoryInput?{projectHistoryInput:tool.projectHistoryInput}:{}),
  revalidate:async(_input,result)=>{try{await workspace.read(actor,result.reference);return result;}catch(error){if(error.statusCode!==404)throw error;return {unavailable:true};}},implementation:{kind:'function',execute:tool.handler}}));
 const resultSchema={type:'object',properties:{path:{type:'string',const:'launch/checklist.md'},revision:{type:'integer',const:1},digest:{type:'string',pattern:'^[a-f0-9]{64}$'}},required:['path','revision','digest'],additionalProperties:false};
 const agent=defineCapability({name:'workspace.prepare',description:'Prepare and verify a working document.',input:{type:'object',properties:{goal:{type:'string'}},required:['goal'],additionalProperties:false},output:resultSchema,effect:'write',retry:'never-replay',authorize,implementation:{kind:'agent',instructions:'Use my_write_workspace to save the exact requested document once. Then call my_read_workspace with its returned reference to verify it. Finish with the exact reference object, not the document body. Do not repeat a successful write.',tools:tools.map(t=>t.name),verify:async(_input,result,{history})=>(await workspace.read(actor,result)).content===content&&history.calls.some(c=>c.capability==='my_read_workspace'&&c.status==='succeeded')}});
 let step=0;
 const live=Boolean(process.env.DEMO_MODEL_API_KEY);
 const deterministic={name:'deterministic-workspace',next:async()=>{
  if(step++===0)return {type:'call',name:'my_write_workspace',input:{path:'launch/checklist.md',content,mediaType:'text/markdown',expectedRevision:0}};
  const {reference}=await workspace.read(actor,{path:'launch/checklist.md'});
  return step===2?{type:'call',name:'my_read_workspace',input:reference}:{type:'finish',result:reference};
 }};
 const model=live?createModelProvider({apiKey:process.env.DEMO_MODEL_API_KEY,model:process.env.DEMO_MODEL,provider:process.env.DEMO_PROVIDER||'openai',baseUrl:process.env.DEMO_BASE_URL||''}):deterministic;
 const store=new TaskStore({pool}),dispatcher=new CapabilityDispatcher({capabilities:[...capabilities,agent]});
 runtime=new AgentRuntime({store,dispatcher,model,context:new ContextAssembler({skillRoot:process.cwd()}),version:'core-workspace-v1',maxTurns:8});dispatcher.tasks=runtime;await runtime.initialize();
 await runtime.create({capability:agent,input:{goal:'Save launch/checklist.md with exactly this Markdown content:\n'+content},actor,idempotencyKey:'prepare-checklist'});
 const finished=await runtime.tick();assert.equal(finished.status,'succeeded',finished.error||finished.waiting_reason);
 const first=await new PostgresWorkspaceStore({pool}).read(scope,{path:'launch/checklist.md'});assert.equal(first.content,content);
 await workspace.write(actor,{path:first.reference.path,content:content+'\n- Schedule review',mediaType:'text/markdown',expectedRevision:1});
 assert.equal((await workspace.read(actor,first.reference)).content,content);
 await workspace.remove(actor,{path:first.reference.path,expectedRevision:2});
 await assert.rejects(workspace.read(actor,first.reference),{statusCode:404});
 const raw=await store.history(actor,finished.id),projected=await runtime.context.revalidateHistory({history:raw,actor,dispatcher});assert.equal(projected.calls[0].input.content,undefined);assert.equal(projected.calls[0].inputProjected,true);assert.equal(projected.calls[0].result.unavailable,true);assert.equal(JSON.stringify(projected.calls).includes(content),false);assert.equal(raw.calls[0].input.content,content);
 console.log(JSON.stringify({deletedWritePayloadOmitted:true,application:'core-workspace',modelMode:live?'provider':'deterministic',task:finished.status,versionedReferenceVerified:true,deletedReferenceUnavailable:true,erpUsed:false}));
}finally{if(runtime)await runtime.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
