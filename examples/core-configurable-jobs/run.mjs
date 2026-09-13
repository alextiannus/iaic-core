import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Pool} from 'pg';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createCapabilityMcpServer} from '@immedi/iaic-core/mcp/server.js';
import {AgentRegistry,AgentIdentityStore,TaskStore,AgentRuntime,ContextAssembler,CapabilityDispatcher,defineCapability,createAgentTaskCapabilities,MemoryStore,AssistantMemory,PostgresWorkspaceStore,AssistantWorkspace,SkillCatalog,PostgresKnowledgeStore,KnowledgeCatalog,AssistantSettings,AssistantModels,ModelProfiles,TokenLedger,SessionStore,DeferredTaskStore,createAgentSessions,createAgentDeferredTasks,startSessionTask,createTaskReferenceCapability} from '@immedi/iaic-core';
const connectionString=process.env.DATABASE_URL||process.env.SUBMISSION_TEST_DATABASE_URL;
if(!connectionString)throw new Error('Isolated PostgreSQL URL required');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'core-jobs-')),schema='jobs_'+randomUUID().replaceAll('-','');
const admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let runtime,sessions,deferred,mcpServer,mcpClient;
try{
 const identities=new AgentIdentityStore({pool}),memories=new MemoryStore({pool}),documents=new PostgresWorkspaceStore({pool}),settings=new AssistantSettings({pool}),ledger=new TokenLedger({pool}),sources=new PostgresKnowledgeStore({pool,namespace:'job-guides'}),sessionStore=new SessionStore({pool}),deferredStore=new DeferredTaskStore({pool});
 for(const store of [identities,memories,documents,settings,ledger,sources,sessionStore,deferredStore])await store.initialize();
 for(const skill of ['drafting','editing']){
  await fs.mkdir(path.join(root,skill));await fs.writeFile(path.join(root,skill,'SKILL.md'),`---\nname: ${skill}\ndescription: Prepare a sourced draft.\n---\nRead the organization guide and writing preference. Save a draft without claiming publication.`);
 }
 for(const org of ['alpha','beta'])await sources.put({id:org+'-guide',title:org+' guide',description:'Organization drafting guide',source:{kind:'host-fixture',reference:org},text:org+' source material',policy:{organization:org},expectedRevision:0});
 // This is application policy. Core does not define departments or job taxonomies.
 const memberships={alice:['alpha','beta'],bob:['alpha']};
 const configFor=actor=>{
  if(!memberships[actor.subjectId]?.includes(actor.scopeId))throw Object.assign(new Error('Membership required'),{statusCode:403});
  return registry.definition(actor.jobId).configuration;
 };
 const resolveScope=async actor=>{
  const config=configFor(actor);
  return {applicationId:actor.scopeId,assistantId:actor.jobId,subjectId:JSON.stringify(config.shared?['job',actor.jobId]:['user',actor.subjectId,actor.jobId])};
 };
 let registry=new AgentRegistry({store:identities,resolveScope:async(actor,id)=>{assert.equal(id,actor.jobId);return resolveScope(actor);},authorizeStateChange:async()=>false});
 const memory=new AssistantMemory({store:memories,resolveScope,sourceFor:()=>({kind:'user-request'})});
 const workspace=new AssistantWorkspace({store:documents,resolveScope,sourceFor:()=>({kind:'user-request'})});
 const skills=new SkillCatalog({root,entries:['drafting/SKILL.md','editing/SKILL.md'],selectEntries:({actor})=>configFor(actor).skills});
 const knowledge=new KnowledgeCatalog({store:sources,authorize:async(actor,entry)=>configFor(actor).knowledge.includes(entry.id)&&entry.policy.organization===actor.scopeId});
 const makeSessions=()=>createAgentSessions({store:sessionStore,resolveScope,readTask:async(actor,id)=>{configFor(actor);return store.get(actor,id);},readArtifact:(actor,ref)=>workspace.read(actor,ref)});
 sessions=makeSessions();
 const seenModels=[];
 const profiles=new ModelProfiles({profiles:['standard','alternate'].map(id=>({id,provider:'openai',model:id,credentialRef:'fixture'})),resolveSecret:async()=> 'fixture-only',factory:({model})=>({next:async({messages})=>{
  const context=JSON.parse(messages[1].content),calls=context.calls.filter(c=>c.status==='succeeded');seenModels.push({job:context.agent.definitionId,model});
  let action;
  if(context.goal.goal.startsWith('Schedule')){
   if(calls.length===0)action={type:'call',name:'my_read_assistant_session',input:{sessionId:context.goal.session.id,throughSequence:context.goal.session.throughSequence}};
   else if(calls.length===1)action={type:'call',name:'assistant.schedule',input:{dueAt:'2020-01-01T00:00:00Z',task:{goal:'Use the configured resources and the pinned Session to prepare the requested follow-up.',requiredArtifacts:['follow-up.md'],allowedTools:context.goal.allowedTools.filter(name=>name!=='assistant.schedule'),session:context.goal.session}}};
   else action={type:'finish',result:{summary:'Scheduled the follow-up; its execution is still pending.',artifacts:[]}};
   return {...action,usage:{inputTokens:2,outputTokens:1}};
  }
  const artifactPath=context.goal.requiredArtifacts[0];
  if(calls.length===0)action={type:'call',name:'assistant.skills.list',input:{}};
  else if(calls.length===1)action={type:'call',name:'assistant.skills.read',input:{id:calls[0].result[0].id}};
  else if(calls.length===2)action={type:'call',name:'my_search_knowledge',input:{}};
  else if(calls.length===3){assert.equal(calls[2].result.items.length,1);const ref=calls[2].result.items[0].reference;action={type:'call',name:'my_read_knowledge',input:{id:ref.id,expectedVersion:ref.version}};}
  else if(calls.length===4)action={type:'call',name:'my_read_assistant_memory',input:{key:'style'}};
  else if(calls.length===5)action={type:'call',name:'my_write_workspace',input:{path:artifactPath,content:[context.agent.purpose,calls[1].result.id,calls[3].result.text,calls[4].result.content,...(context.session?context.session.events.filter(e=>e.kind==='user_message').map(e=>e.data.text):[])].join('\n'),expectedRevision:0}};
  else if(calls.length===6)action={type:'call',name:'my_read_workspace',input:{path:artifactPath}};
  else action={type:'finish',result:{summary:'Prepared a sourced draft; publication remains an application operation.',artifacts:[calls[6].result.reference]}};
  return {...action,usage:{inputTokens:2,outputTokens:1}};
 }})});
 const models=new AssistantModels({settings,profiles,ledger,resolveScope,tokenPolicies:Object.fromEntries(['standard','alternate'].map(id=>[id,{maximum:100,price:{revision:'fixture-platform-units',input:2,cachedInput:1,output:3}}]))});
 const authorize=async actor=>{configFor(actor);return true;};
 const capabilities=createAgentTaskCapabilities({name:'job.work',memory,workspace,skillCatalog:skills,knowledge,sessions,extraCapabilities:[createTaskReferenceCapability({authorize,readTask:(actor,id)=>store.get(actor,id),readArtifact:(actor,ref)=>workspace.read(actor,ref)})],deferred:Object.fromEntries(['schedule','get','list','cancel','retry','findRequest'].map(method=>[method,(...args)=>deferred[method](...args)])),authorize,verifyOutcome:async(input,result,{actor,history})=>{
  const successful=history.calls.filter(c=>c.status==='succeeded');
  if(input.goal.startsWith('Schedule'))return result.artifacts.length===0&&successful.some(c=>c.capability==='assistant.schedule'&&c.result.state==='queued');
  return successful.length===7&&result.artifacts.length===1&&(await workspace.read(actor,result.artifacts[0])).content.includes(actor.scopeId+' source material');
 }}).map(cap=>defineCapability({...cap,authorize:async(actor,input)=>{
  const config=configFor(actor);
  if(cap.implementation.kind==='agent'&&(!input.allowedTools||input.allowedTools.some(tool=>!config.tools.includes(tool))))return false;
  if(cap.implementation.kind==='function'&&!config.tools.includes(cap.name))return false;
  return cap.authorize(actor,input);
 }}));
 // Keep job selection in the persisted task actor, including across worker restart.
 // A trusted host entrypoint authenticates users before constructing this actor.
 const actorCodec={encode:a=>[a.scopeId,JSON.stringify([a.subjectId,a.jobId])],decode:([scopeId,subject])=>{const [subjectId,jobId]=JSON.parse(subject);return {scopeId,subjectId,jobId};}};
 const dispatcher=new CapabilityDispatcher({capabilities}),store=new TaskStore({pool,actorCodec});
 const runtimeOptions={store,dispatcher,model:{name:'host-resolver'},resolveModel:request=>models.resolve(request),context:new ContextAssembler({skillRoot:root,sessionProvider:({actor,task})=>task.input.session?sessions.context(actor,task.input.session):null}),version:'configurable-jobs-v1',agentIdentity:{bind:({actor,capability})=>registry.bind(actor,actor.jobId,capability.name),check:({actor,task,binding})=>registry.check(actor,binding,task.capability)}};
 runtime=new AgentRuntime(runtimeOptions);dispatcher.tasks=runtime;await runtime.initialize();
 const makeDeferred=()=>createAgentDeferredTasks({name:'job.work',store:deferredStore,resolveScope:async actor=>{configFor(actor);return {applicationId:actor.scopeId,assistantId:actor.jobId,subjectId:actor.subjectId};},restoreActor:async scope=>({scopeId:scope.applicationId,subjectId:scope.subjectId,jobId:scope.assistantId}),dispatcher,sessions,taskStore:store,isEnabled:()=>true});
 deferred=makeDeferred();
 const tools=['my_read_agent_task','my_read_assistant_session','assistant.schedule','assistant.skills.list','assistant.skills.read','my_search_knowledge','my_read_knowledge','my_read_assistant_memory','my_write_workspace','my_read_workspace'];
 const configurations=[
  {id:'personal',purpose:'Prepare drafts on behalf of this user in this organization.',capabilities:['job.work'],configuration:{shared:false,skills:['drafting/SKILL.md'],knowledge:['alpha-guide','beta-guide'],tools}},
  {id:'editorial',role:'Editorial desk',purpose:'Prepare drafts on behalf of this organization.',capabilities:['job.work'],configuration:{shared:true,skills:['editing/SKILL.md'],knowledge:['alpha-guide','beta-guide'],tools}}
 ];
 // Application-owned file stands in for an application database. Configuration
 // adds no executable code, changes no Runtime and creates no framework UI.
 const configPath=path.join(root,'jobs.json');await fs.writeFile(configPath,JSON.stringify(configurations));
 for(const config of JSON.parse(await fs.readFile(configPath,'utf8')))registry.register(config);
 const actors=[{scopeId:'alpha',subjectId:'alice',jobId:'personal'},{scopeId:'beta',subjectId:'alice',jobId:'personal'},{scopeId:'alpha',subjectId:'alice',jobId:'editorial'}];
 const queued=[];
 for(const actor of actors){
  const scope=await resolveScope(actor);
  await memory.remember(actor,{key:'style',kind:'preference',content:JSON.stringify(scope),expectedRevision:0});
  await ledger.grant(scope,{reference:'fixture-grant',amount:1000,evidence:{fixture:true}});
  if(actor.jobId==='editorial')await models.select(actor,{profileId:'alternate'});
  queued.push(await dispatcher.invoke('job.work',{goal:'Use the configured Skill, organization source and memory to prepare draft.md.',requiredArtifacts:['draft.md'],allowedTools:configFor(actor).tools},{actor,callId:'draft'}));
 }
 await assert.rejects(dispatcher.invoke('my_forget_assistant_memory',{key:'style',expectedRevision:1},{actor:actors[0],callId:'not-configured'}),{statusCode:403});
 await assert.rejects(knowledge.read(actors[0],{id:'beta-guide'}),{statusCode:404});
 // Reload application configuration and reconstruct the existing Runtime before
 // executing queued work. This is service reconstruction, not a process crash.
 await runtime.stop();registry=new AgentRegistry({store:identities,definitions:JSON.parse(await fs.readFile(configPath,'utf8')),resolveScope:registry.resolveScope});
 runtime=new AgentRuntime(runtimeOptions);dispatcher.tasks=runtime;await runtime.initialize();
 for(let i=0;i<actors.length;i++){const result=await runtime.tick();assert.equal(result.status,'succeeded',result.error||result.waiting_reason);}
 assert.equal(new Set(queued.map(t=>t.agent.instanceId)).size,3);
 assert.ok(seenModels.every(({job,model})=>model===(job==='editorial'?'alternate':'standard')));
 for(const actor of actors){assert.equal((await ledger.balance(await resolveScope(actor))).balance,'944');assert.equal((await ledger.pending(await resolveScope(actor))).length,0);}
 const bob={scopeId:'alpha',subjectId:'bob',jobId:'editorial'};
 assert.deepEqual((await registry.describe(bob,'editorial')).instance,(await registry.describe(actors[2],'editorial')).instance);
 assert.equal((await workspace.read(bob,{path:'draft.md'})).content,(await workspace.read(actors[2],{path:'draft.md'})).content);
 await assert.rejects(workspace.read({...bob,jobId:'personal'},{path:'draft.md'}),{statusCode:404});
 assert.notEqual((await memory.read(actors[0],{key:'style'})).content,(await memory.read(actors[1],{key:'style'})).content);
 // Continue a configured personal job from a Session into autonomous future work.
 // The due timestamp is already elapsed in this deterministic example: dispatch
 // is deliberately held until after the conversation closes and service rebuilds.
 const owner=actors[0],session=await sessions.create(owner,{requestKey:'follow-up-session'});
 const message='Project Aurora: prepare the draft, without publishing it.';
 await sessions.appendMessage(owner,{sessionId:session.id,text:message,requestKey:'goal',expectedSequence:0});
 const input={goal:'Schedule the follow-up from this Session.',session:{id:session.id,throughSequence:1},allowedTools:tools};
 const parent=await startSessionTask({sessions,actor:owner,input,startTask:()=>dispatcher.invoke('job.work',input,{actor:owner,callId:'follow-up-parent'})});
 assert.equal((await runtime.tick()).status,'succeeded');
 const intents=(await deferred.list(owner,{})).items;assert.equal(intents.length,1);assert.equal(intents[0].state,'queued');
 await sessions.setState(owner,{sessionId:session.id,state:'closed',requestKey:'disconnect',expectedSequence:2});
 await runtime.stop();await deferred.stop();sessions=makeSessions();deferred=makeDeferred();
 runtime=new AgentRuntime(runtimeOptions);dispatcher.tasks=runtime;await runtime.initialize();
 // A future Task uses the job's current selection, without altering the parent.
 await models.select(owner,{profileId:'alternate'});
 const receipt=await deferred.tick();assert.equal(receipt.state,'dispatched');assert.equal(await deferred.tick(),null);
 const child=await runtime.tick();assert.equal(child.id,receipt.taskId);assert.equal(child.status,'succeeded',child.error||child.waiting_reason);
 assert.notEqual(child.model,parent.model);assert.equal((await store.get(owner,parent.id)).model,parent.model);
 assert.deepEqual(child.input.session,input.session);assert.equal(child.agent.instanceId,parent.agent.instanceId);
 const artifact=await workspace.read(owner,{path:'follow-up.md'});assert.ok(artifact.content.includes(message));
 const timeline=await sessions.read(owner,{sessionId:session.id});assert.equal(timeline.session.state,'closed');
 const context=await sessions.context(owner,{id:session.id,throughSequence:timeline.events.at(-1).sequence});
 assert.deepEqual(context.events.filter(e=>e.kind==='task_ref').map(e=>e.data.status),['succeeded','succeeded']);
 assert.deepEqual(context.events.at(-1).data.artifacts,[artifact.reference]);
 assert.equal((await ledger.balance(await resolveScope(owner))).balance,'867');assert.equal((await ledger.pending(await resolveScope(owner))).length,0);
 // The external Agent uses the same configured capabilities directly, or asks
 // the application Agent to perform durable work. Its own Runtime is irrelevant.
 const entry={capabilities:dispatcher.capabilities,invoke:(name,input,execution)=>{
  if(name!=='job.work')return dispatcher.invoke(name,input,execution);
  if(['deferred:','iaic-handoff:'].some(prefix=>execution.callId?.startsWith(prefix)))throw Object.assign(new Error('Reserved internal task key'),{statusCode:400});
  return startSessionTask({sessions,actor:execution.actor,input,startTask:()=>dispatcher.invoke(name,input,execution)});
 }};
 mcpServer=createCapabilityMcpServer({dispatcher:entry,resolveAccess:async()=>({actor:owner,capabilities:['job.work',...configFor(owner).tools]})});
 mcpClient=new Client({name:'external-personal-agent',version:'1'});
 const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();await mcpServer.connect(serverTransport);await mcpClient.connect(clientTransport);
 const call=async(name,input,requestKey)=>{const result=await mcpClient.callTool({name,arguments:{input,...(requestKey?{requestKey}:{})}});assert.notEqual(result.isError,true,JSON.stringify(result));return JSON.parse(result.content[0].text);};
 const beforeInference=seenModels.length;
 assert.deepEqual(await call('my_read_workspace',{path:'follow-up.md'}),JSON.parse(JSON.stringify(await workspace.read(owner,{path:'follow-up.md'}))));
 assert.deepEqual(await call('assistant.skills.list',{}),await skills.list({actor:owner}));
 assert.equal(seenModels.length,beforeInference); // External direct operations invoke no hosted model.
 const externalInput={goal:'Prepare another sourced draft using this Session.',requiredArtifacts:['external.md'],session:input.session,allowedTools:tools.filter(name=>name!=='assistant.schedule')};
 const external=await call('job.work',externalInput,'external-request');
 assert.equal((await entry.invoke('job.work',externalInput,{actor:owner,callId:'external-request'})).id,external.id);
 assert.equal((await call('my_read_agent_task',{taskId:external.id})).status,'queued');
 assert.equal((await runtime.tick()).status,'succeeded');
 const completed=await call('my_read_agent_task',{taskId:external.id});assert.equal(completed.status,'succeeded');
 assert.equal((await call('my_read_workspace',completed.artifacts[0])).content.includes(message),true);
 assert.equal((await sessions.read(owner,{sessionId:session.id})).events.filter(e=>e.kind==='task_ref'&&e.data.taskId===external.id).length,1);
 // Host explicitly revises the job; its original task binding remains immutable.
 const first=registry.definition('editorial');registry.register({...first,purpose:'Prepare concise sourced drafts.'},{expectedRevision:first.revision});
 await assert.rejects(registry.check(actors[2],queued[2].agent,'job.work'),{statusCode:409});
 console.log(JSON.stringify({application:'core-configurable-jobs',registeredAfterRuntimeStart:true,hostOwnedConfiguration:true,userOrganizationScopes:true,organizationSharedJob:true,skillsKnowledgeMemoryWorkspaceModelsCombined:true,defaultSystemModel:true,platformAllowanceSettled:true,reloadedQueuedWork:true,configurationRevisionChecked:true,sessionToScheduledWork:true,closedConversationContinues:true,resultReturnsToSession:true,futureUsesCurrentModel:true,externalDirectOperations:true,externalDurableWork:true,sameTaskAdmission:true,erpUsed:false,modelMode:'deterministic'}));
}finally{await mcpClient?.close();await mcpServer?.close();await deferred?.stop();await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await fs.rm(root,{recursive:true,force:true});}
