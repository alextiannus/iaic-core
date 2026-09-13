import {
 AgentRegistry,AgentIdentityStore,TaskStore,AgentRuntime,ContextAssembler,CapabilityDispatcher,defineCapability,
 createAgentTaskCapabilities,MemoryStore,AssistantMemory,PostgresWorkspaceStore,AssistantWorkspace,SkillCatalog,
 PostgresKnowledgeStore,KnowledgeCatalog,AssistantSettings,AssistantModels,ModelProfiles,TokenLedger,SessionStore,createAgentSessions,startSessionTask
} from '@immedi/iaic-core';

// This is application-owned composition. Each imported Core module remains independently replaceable.
export async function openApplication({pool,skillRoot,job,profiles,resolveSecret,modelFactory,userModels=null,tokenPolicies,authorize,verifyOutcome,version}){
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
 const capabilities=createAgentTaskCapabilities({name:'agent.work',description:job.purpose,memory,workspace,skillCatalog:skills,knowledge,sessions,authorize:check,verifyOutcome}).map(cap=>defineCapability({...cap,authorize:async(actor,input)=>{
  await check(actor);const tools=job.configuration.tools;
  if(cap.implementation.kind==='agent'&&(!input.allowedTools||input.allowedTools.some(name=>!tools.includes(name))))return false;
  if(cap.implementation.kind==='function'&&!tools.includes(cap.name))return false;
  return cap.authorize(actor,input);
 }}));
 let runtime;
 const idSchema={type:'object',properties:{id:{type:'string',minLength:1}},required:['id'],additionalProperties:false};
 for(const action of ['get','cancel','resume'])capabilities.push(defineCapability({name:'tasks.'+action,description:action+' the current owner task',input:idSchema,output:{type:'object'},effect:action==='get'?'read':'write',...(action==='get'?{}:{retry:action==='cancel'?'idempotent':'never-replay'}),authorize:check,implementation:{kind:'function',execute:({id},{actor})=>action==='get'?runtime.get(actor,id):runtime.transition(actor,id,{action})}}));
 const dispatcher=new CapabilityDispatcher({capabilities});
 runtime=new AgentRuntime({store:tasks,dispatcher,model:{name:'host-model-resolver'},resolveModel:request=>models.resolve(request),context:new ContextAssembler({skillRoot,sessionProvider:({actor,task})=>task.input.session?sessions.context(actor,task.input.session):null}),version,agentIdentity:{bind:({actor,capability})=>registry.bind(actor,job.id,capability.name),check:({actor,task,binding})=>registry.check(actor,binding,task.capability)}});
 dispatcher.tasks=runtime;
 try{await runtime.initialize();}catch(error){await runtime.stop();throw error;}
 const entry={capabilities:dispatcher.capabilities,invoke:(name,input,context)=>name==='agent.work'?startSessionTask({sessions,actor:context.actor,input,startTask:()=>dispatcher.invoke(name,input,context)}):dispatcher.invoke(name,input,context)};
 return {dispatcher:entry,runtime,tasks,registry,memory,workspace,skills,knowledge,knowledgeStore,sessions,models,ledger,scope,close:()=>runtime.stop()};
}
