import {
 AgentRegistry,AgentIdentityStore,TaskStore,AgentRuntime,ContextAssembler,CapabilityDispatcher,defineCapability,TaskPlans,
 createAgentTaskCapabilities,createTaskControlCapabilities,TaskListing,createTaskListCapability,MemoryStore,AssistantMemory,PostgresWorkspaceStore,AssistantWorkspace,SkillCatalog,
 PostgresKnowledgeStore,KnowledgeCatalog,AssistantSettings,AssistantModels,AssistantModelRouting,ModelProfiles,TokenLedger,SessionStore,createAgentSessions,startSessionTask
} from '@immedi/iaic-core';

// This is application-owned composition. Each imported Core module remains independently replaceable.
export async function openApplication({pool,skillRoot,job,profiles,resolveSecret,modelFactory,userModels=null,routing=null,tokenPolicies,authorize,verifyOutcome,version,runtimeLimits={},taskCursorKey=null,toolCallLimits,enablePlans=false}){
 if(typeof enablePlans!=='boolean')throw new Error('enablePlans must be a boolean');
 if(!runtimeLimits||Object.getPrototypeOf(runtimeLimits)!==Object.prototype||Object.entries(runtimeLimits).some(([k,v])=>!['maxTurns','maxCalls','maxBatchCalls','modelTimeoutMs','taskTimeoutMs'].includes(k)||!Number.isSafeInteger(v)||v<1))throw new Error('Supply positive integer Runtime limits only');
 if(typeof authorize!=='function'||typeof verifyOutcome!=='function')throw new Error('Supply current application authorization and independent outcome verification');
 const check=async actor=>{if(await authorize(actor)!==true)throw Object.assign(new Error('Application access denied'),{statusCode:403});return true;};
 const scope=async actor=>{await check(actor);return {applicationId:actor.scopeId,assistantId:job.id,subjectId:JSON.stringify([actor.subjectId,job.id])};};
 const identities=new AgentIdentityStore({pool}),memoryStore=new MemoryStore({pool}),workspaceStore=new PostgresWorkspaceStore({pool}),settings=new AssistantSettings({pool}),ledger=new TokenLedger({pool}),knowledgeStore=new PostgresKnowledgeStore({pool,namespace:job.id}),sessionStore=new SessionStore({pool}),tasks=new TaskStore({pool});
 for(const store of [identities,memoryStore,workspaceStore,settings,ledger,knowledgeStore,sessionStore])await store.initialize();
 const registry=new AgentRegistry({store:identities,definitions:[job],resolveScope:scope,authorizeStateChange:check});
 const memory=new AssistantMemory({store:memoryStore,resolveScope:scope,sourceFor:()=>({kind:'user-request'})});
 const workspace=new AssistantWorkspace({store:workspaceStore,resolveScope:scope,sourceFor:()=>({kind:'user-request'})});
 const skills=new SkillCatalog({root:skillRoot,entries:job.configuration.skills,selectEntries:async({actor})=>{await check(actor);return job.configuration.skills;}});
 const knowledge=new KnowledgeCatalog({store:knowledgeStore,authorize:async(actor,entry)=>{await check(actor);return entry.policy.organization===actor.scopeId&&job.configuration.knowledge.includes(entry.id);}});
 const sessions=createAgentSessions({store:sessionStore,resolveScope:scope,readTask:async(actor,id)=>{await check(actor);return tasks.get(actor,id);},readArtifact:(actor,ref)=>workspace.read(actor,ref)});
 const modelProfiles=new ModelProfiles({profiles,resolveSecret,...(modelFactory?{factory:modelFactory}:{})});
 const models=new AssistantModels({settings,profiles:modelProfiles,userModels,ledger,resolveScope:scope,tokenPolicies});
 const modelRouting=routing===null?null:new AssistantModelRouting({models,resolvePolicy:routing.resolvePolicy,availability:routing.availability});
 const plans=enablePlans?new TaskPlans({workspace,readTask:(actor,id)=>runtime.state(actor,id)}):null;
 const capabilities=createAgentTaskCapabilities({name:'agent.work',description:job.purpose,memory,workspace,skillCatalog:skills,knowledge,sessions,authorize:check,verifyOutcome,toolCallLimits,plans}).map(cap=>defineCapability({...cap,authorize:async(actor,input)=>{
  await check(actor);const tools=job.configuration.tools;
  if(cap.implementation.kind==='agent'&&(!input.allowedTools||input.allowedTools.some(name=>!tools.includes(name))))return false;
  if(cap.implementation.kind==='function'&&!tools.includes(cap.name))return false;
  return cap.authorize(actor,input);
 }}));
 let runtime;
 capabilities.push(...createTaskControlCapabilities({runtime:{get:(...args)=>runtime.get(...args),state:(...args)=>runtime.state(...args),transition:(...args)=>runtime.transition(...args),transitionReceipt:(...args)=>runtime.transitionReceipt(...args)},receipts:true,authorize:check,project:row=>row}));
 const taskListing=taskCursorKey===null?null:new TaskListing({store:tasks,readTask:(actor,id)=>runtime.state(actor,id),resolveOwner:async actor=>{await check(actor);return JSON.stringify([actor.scopeId,actor.subjectId]);},cursorKey:taskCursorKey});
 if(taskListing)capabilities.push(createTaskListCapability({listing:taskListing,authorize:check}));
 const dispatcher=new CapabilityDispatcher({capabilities});
 runtime=new AgentRuntime({...runtimeLimits,store:tasks,dispatcher,model:{name:'host-model-resolver'},resolveModel:request=>(modelRouting||models).resolve(request),context:new ContextAssembler({skillRoot,planProvider:plans?({actor,task})=>plans.read(actor,{id:task.id}):null,overflow:'omit-old-results',sessionProvider:({actor,task})=>task.input.session?sessions.context(actor,task.input.session):null}),version,agentIdentity:{bind:({actor,capability})=>registry.bind(actor,job.id,capability.name),check:({actor,task,binding})=>registry.check(actor,binding,task.capability)}});
 dispatcher.tasks=runtime;
 try{await runtime.initialize();}catch(error){await runtime.stop();throw error;}
 const entry={capabilities:dispatcher.capabilities,invoke:(name,input,context)=>name==='agent.work'?startSessionTask({sessions,actor:context.actor,input,startTask:()=>dispatcher.invoke(name,input,context)}):dispatcher.invoke(name,input,context)};
 return {dispatcher:entry,runtime,tasks,taskListing,plans,registry,memory,workspace,skills,knowledge,knowledgeStore,sessions,models,modelRouting,ledger,scope,close:()=>runtime.stop()};
}
