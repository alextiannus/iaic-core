import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Pool} from 'pg';
import {AgentRuntime,TaskStore,MemoryStore,AssistantMemory,PostgresWorkspaceStore,AssistantWorkspace,SkillCatalog,ContextAssembler,CapabilityDispatcher,createAssistantTaskCapabilities,createModelProvider} from '@immedi/iaic-core';
const connectionString=process.env.DATABASE_URL||process.env.SUBMISSION_TEST_DATABASE_URL;
if(!connectionString)throw new Error('Set an isolated PostgreSQL database URL');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'core-assistant-')),admin=new Pool({connectionString}),schema='core_assistant_'+randomUUID().replaceAll('-','');
await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let runtime;
const actor={scopeId:'assistant-demo',subjectId:'reader'},scope={applicationId:'assistant-demo',assistantId:'helper',subjectId:'reader'};
try{
 await fs.mkdir(path.join(root,'drafting'));
 await fs.writeFile(path.join(root,'drafting/SKILL.md'),'---\nname: drafting\ndescription: Prepare short launch checklists using the user writing preference.\n---\nUse one Markdown heading and exactly two bullet items. Do not claim the checklist items were completed. Save the draft and read it back before finishing.');
 const memories=new MemoryStore({pool}),documents=new PostgresWorkspaceStore({pool});await memories.initialize();await documents.initialize();
 const memory=new AssistantMemory({store:memories,resolveScope:()=>scope,sourceFor:()=>({kind:'user-request'})});
 const workspace=new AssistantWorkspace({store:documents,resolveScope:()=>scope,sourceFor:()=>({kind:'user-request'})});
 await memory.remember(actor,{key:'style',kind:'preference',content:'Use English and keep checklist items concise.',expectedRevision:0});
 const skillCatalog=new SkillCatalog({root,entries:['drafting/SKILL.md'],selectEntries:({actor:current})=>current?.scopeId===actor.scopeId&&current?.subjectId===actor.subjectId?['drafting/SKILL.md']:[]});
 const verifyOutcome=async(_input,result,{history})=>{
  const artifact=await workspace.read(actor,result.artifacts[0]);const lines=artifact.content.trim().split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  return lines.length===3&&/^# /.test(lines[0])&&lines.slice(1).every(line=>/^- /.test(line))&&/review.*draft/i.test(artifact.content)&&/confirm.*owner/i.test(artifact.content)&&
   ['my_list_assistant_memories','assistant.skills.read','my_read_workspace'].every(name=>history.calls.some(call=>call.capability===name&&call.status==='succeeded'));
 };
 const capabilities=createAssistantTaskCapabilities({memory,workspace,skillCatalog,authorize:async a=>a.scopeId===actor.scopeId&&a.subjectId===actor.subjectId,verifyOutcome});
 const agent=capabilities.find(c=>c.name==='assistant.run');let step=0;
 const live=Boolean(process.env.DEMO_MODEL_API_KEY);
 const deterministic={name:'deterministic-assistant',next:async()=>{
  const actions=[{type:'call',name:'my_list_assistant_memories',input:{}},{type:'call',name:'assistant.skills.list',input:{}},{type:'call',name:'assistant.skills.read',input:{id:'drafting/SKILL.md'}},{type:'call',name:'my_write_workspace',input:{path:'launch/checklist.md',content:'# Launch checklist\n- Review draft\n- Confirm owner',mediaType:'text/markdown',expectedRevision:0}},{type:'call',name:'my_read_workspace',input:{path:'launch/checklist.md'}}];
  if(step<actions.length)return actions[step++];
  return {type:'finish',result:{summary:'Prepared a draft checklist; the actions remain to be done.',artifacts:[(await workspace.read(actor,{path:'launch/checklist.md'})).reference]}};
 }};
 const model=live?createModelProvider({apiKey:process.env.DEMO_MODEL_API_KEY,model:process.env.DEMO_MODEL,provider:process.env.DEMO_PROVIDER||'openai',baseUrl:process.env.DEMO_BASE_URL||''}):deterministic;
 const store=new TaskStore({pool}),dispatcher=new CapabilityDispatcher({capabilities});
 runtime=new AgentRuntime({store,dispatcher,model,context:new ContextAssembler({skillRoot:root}),version:'core-assistant-v1'});dispatcher.tasks=runtime;await runtime.initialize();
 await runtime.create({capability:agent,input:{goal:'Read my stored writing preference and the drafting Skill. Prepare launch/checklist.md for two future actions: review the draft and confirm the owner. Save it and read it back before returning the reference.',requiredArtifacts:['launch/checklist.md']},actor,idempotencyKey:'prepare-checklist'});
 const finished=await runtime.tick();
 const history=await store.history(actor,finished.id);
 if(finished.status!=='succeeded')console.error(JSON.stringify({status:finished.status,reason:finished.waiting_reason,error:finished.error,calls:history.calls.map(c=>({capability:c.capability,status:c.status,input:c.input,result:c.result,error:c.error})),feedback:history.events.filter(e=>['feedback','verification','model_response'].includes(e.kind)).map(e=>({kind:e.kind,data:e.data}))}));
 assert.equal(finished.status,'succeeded',finished.error||finished.waiting_reason);assert.equal(await verifyOutcome({},finished.result,{history}),true);
 const marker='private-history-'+randomUUID(),memoryCalls=[];
 for(const [name,input] of [['my_remember_assistant_memory',{key:'temporary',kind:'note',content:marker}],['my_list_assistant_memories',{query:marker}],['my_read_assistant_memory',{key:'temporary'}]]){
  const id=randomUUID(),result=await dispatcher.invoke(name,input,{actor,callId:id});memoryCalls.push({id,capability:name,input,result,status:'succeeded'});
 }
 await memory.forget(actor,{key:'temporary',expectedRevision:1});
 const projection=await runtime.context.assemble({task:{input:{goal:'Check forgotten memory projection'}},capability:agent,history:{calls:memoryCalls,events:[]},actor,dispatcher});assert.equal(JSON.stringify(projection).includes(marker),false);assert.equal(memoryCalls[0].input.content,marker);
 console.log(JSON.stringify({memoryHistoryProjection:true,application:'core-assistant',modelMode:live?'provider':'deterministic',task:finished.status,memorySkillWorkspaceCombined:true,checklistRubricPassed:true,calls:history.calls.map(c=>({capability:c.capability,status:c.status})),erpUsed:false}));
}finally{if(runtime)await runtime.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await fs.rm(root,{recursive:true,force:true});}
