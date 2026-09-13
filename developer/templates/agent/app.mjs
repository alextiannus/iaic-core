import {
 ReleaseBoundAgentIdentity,MandateStore,AssistantMandates,AgentRegistry,AgentIdentityStore,TaskStore,AgentRuntime,ContextAssembler,CapabilityDispatcher,defineCapability,TaskPlans,DeferredTaskStore,createAgentDeferredTasks,
 EventStore,AssistantEvents,PostgresEventSubscriptions,EventSubscriptions,EventTaskSubscriptions,EVENT_SUBSCRIPTION_TASK_PREFIX,
 createAgentTaskCapabilities,createTaskControlCapabilities,TaskListing,createTaskListCapability,MemoryStore,AssistantMemory,PostgresWorkspaceStore,AssistantWorkspace,SkillCatalog,
 PostgresKnowledgeStore,KnowledgeCatalog,AssistantSettings,AssistantModels,AssistantModelRouting,ModelProfiles,TokenLedger,SessionStore,createAgentSessions,startSessionTask
} from '@immedi/iaic-core';

// This is application-owned composition. Each imported Core module remains independently replaceable.
export async function openApplication({pool,skillRoot,job,profiles,resolveSecret,modelFactory,userModels=null,routing=null,tokenPolicies,authorize,verifyOutcome,version,runtimeLimits={},taskCursorKey=null,toolCallLimits,enablePlans=false,scheduling=null,eventWork=null,executionPolicy=null,mandates=null,extraCapabilities=[],releaseBinding=null}){
 if(releaseBinding!==null&&(!releaseBinding||releaseBinding.implementationRevision!==version))throw new Error('Release binding must match the explicit application version');
 if(!Array.isArray(extraCapabilities))throw new Error('extraCapabilities must be an array of host-defined Capabilities');
 if(mandates!==null&&(typeof mandates?.authorizeGrant!=='function'||typeof mandates?.sourceFor!=='function'))throw new Error('Mandates require trusted authorizeGrant and sourceFor ports');
 if(eventWork!==null&&(!scheduling||typeof eventWork?.sourceFor!=='function'||typeof eventWork?.buildTask!=='function'))throw new Error('Event work requires scheduling identity restoration, sourceFor and buildTask ports');
 if(scheduling!==null&&(!scheduling||typeof scheduling.restoreActor!=='function'||(scheduling.isEnabled!==undefined&&typeof scheduling.isEnabled!=='function')))throw new Error('Scheduling requires a trusted restoreActor port and optional isEnabled function');
 if(typeof enablePlans!=='boolean')throw new Error('enablePlans must be a boolean');
 if(!runtimeLimits||Object.getPrototypeOf(runtimeLimits)!==Object.prototype||Object.entries(runtimeLimits).some(([k,v])=>!['maxTurns','maxCalls','maxBatchCalls','modelTimeoutMs','taskTimeoutMs'].includes(k)||!Number.isSafeInteger(v)||v<1))throw new Error('Supply positive integer Runtime limits only');
 if(typeof authorize!=='function'||typeof verifyOutcome!=='function')throw new Error('Supply current application authorization and independent outcome verification');
 const check=async actor=>{if(await authorize(actor)!==true)throw Object.assign(new Error('Application access denied'),{statusCode:403});return true;};
 const scope=async actor=>{await check(actor);return {applicationId:actor.scopeId,assistantId:job.id,subjectId:JSON.stringify([actor.subjectId,job.id])};};
 const identities=new AgentIdentityStore({pool}),memoryStore=new MemoryStore({pool}),workspaceStore=new PostgresWorkspaceStore({pool}),settings=new AssistantSettings({pool}),ledger=new TokenLedger({pool}),knowledgeStore=new PostgresKnowledgeStore({pool,namespace:job.id}),sessionStore=new SessionStore({pool}),tasks=new TaskStore({pool});
 for(const store of [identities,memoryStore,workspaceStore,settings,ledger,knowledgeStore,sessionStore])await store.initialize();
 const mandateStore=mandates?new MandateStore({pool}):null;if(mandateStore)await mandateStore.initialize();
 const assistantMandates=mandates?new AssistantMandates({store:mandateStore,resolveScope:scope,authorizeGrant:mandates.authorizeGrant,sourceFor:mandates.sourceFor}):null;
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
 const eventStore=eventWork?new EventStore({pool}):null,subscriptionStore=eventWork?new PostgresEventSubscriptions({pool}):null;
 if(eventWork){await eventStore.initialize();await subscriptionStore.initialize();}
 const events=eventWork?new AssistantEvents({store:eventStore,resolveScope:scope,sourceFor:eventWork.sourceFor}):null;
 const eventSubscriptions=eventWork?new EventSubscriptions({store:subscriptionStore,events:eventStore,resolveScope:scope,authorize:check}):null;
 const deferredStore=scheduling?new DeferredTaskStore({pool,claimScope:{assistantId:job.id}}):null;if(deferredStore)await deferredStore.initialize();
 const deferred=scheduling?createAgentDeferredTasks({name:'agent.work',store:deferredStore,resolveScope:scope,validateTask:assistantMandates?(actor,input)=>assistantMandates.checkTask(actor,{capability:'agent.work',input}):null,restoreActor:async original=>{const actor=await scheduling.restoreActor(original),current=await scope(actor);if(['applicationId','assistantId','subjectId'].some(key=>current[key]!==original[key]))throw Object.assign(new Error('Restored schedule identity does not match its owner'),{statusCode:403});return actor;},dispatcher:{get capabilities(){return dispatcher.capabilities;},invoke:(...args)=>dispatcher.invoke(...args)},taskStore:tasks,sessions,isEnabled:scheduling.isEnabled,reservedPrefixes:['agent-call:',...(eventWork?[EVENT_SUBSCRIPTION_TASK_PREFIX]:[])]}):null;
 const eventTasks=eventWork?new EventTaskSubscriptions({subscriptions:eventSubscriptions,deferred,buildTask:eventWork.buildTask}):null;
 const capabilities=createAgentTaskCapabilities({name:'agent.work',description:job.purpose,memory,workspace,skillCatalog:skills,knowledge,sessions,events,mandates:assistantMandates,extraCapabilities,authorize:check,verifyOutcome,toolCallLimits,plans,deferred}).map(cap=>defineCapability({...cap,authorize:async(actor,input)=>{
  await check(actor);const tools=job.configuration.tools;
  if(cap.implementation.kind==='agent'&&(!input.allowedTools||input.allowedTools.some(name=>!tools.includes(name))))return false;
  if(cap.implementation.kind==='function'&&!tools.includes(cap.name))return false;
  return cap.authorize(actor,input);
 }}));
 let runtime;
 capabilities.push(...createTaskControlCapabilities({runtime:{get:(...args)=>runtime.get(...args),state:(...args)=>runtime.state(...args),transition:(...args)=>runtime.transition(...args),transitionReceipt:(...args)=>runtime.transitionReceipt(...args)},receipts:true,authorize:check,project:row=>row}));
 const taskListing=taskCursorKey===null?null:new TaskListing({store:tasks,readTask:(actor,id)=>runtime.state(actor,id),resolveOwner:async actor=>{await check(actor);return JSON.stringify([actor.scopeId,actor.subjectId]);},cursorKey:taskCursorKey});
 if(taskListing)capabilities.push(createTaskListCapability({listing:taskListing,authorize:check}));
 const dispatcher=new CapabilityDispatcher({capabilities,executionPolicy});
 const identity={bind:({actor,capability})=>registry.bind(actor,job.id,capability.name),check:({actor,task,binding})=>registry.check(actor,binding,task.capability)};
 const agentIdentity=releaseBinding===null?identity:new ReleaseBoundAgentIdentity({identity,releases:releaseBinding.releases,reference:releaseBinding.reference,implementationRevision:releaseBinding.implementationRevision});
 runtime=new AgentRuntime({...runtimeLimits,store:tasks,dispatcher,mandates:assistantMandates,model:{name:'host-model-resolver'},resolveModel:request=>(modelRouting||models).resolve(request),context:new ContextAssembler({skillRoot,planProvider:plans?({actor,task})=>plans.read(actor,{id:task.id}):null,overflow:'omit-old-results',sessionProvider:({actor,task})=>task.input.session?sessions.context(actor,task.input.session):null}),version,agentIdentity});
 dispatcher.tasks=runtime;
 try{await runtime.initialize();}catch(error){await runtime.stop();throw error;}
 const entry={capabilities:dispatcher.capabilities,invoke:(name,input,context)=>name==='agent.work'?startSessionTask({sessions,actor:context.actor,input,startTask:()=>dispatcher.invoke(name,input,context)}):dispatcher.invoke(name,input,context)};
 return {dispatcher:entry,mandates:assistantMandates,runtime,tasks,taskListing,plans,deferred,events,eventSubscriptions,eventTasks,registry,memory,workspace,skills,knowledge,knowledgeStore,sessions,models,modelRouting,ledger,scope,start:()=>{deferred?.start();runtime.start();},close:async()=>{await deferred?.stop();await runtime.stop();}};
}
