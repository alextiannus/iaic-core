import {createHash} from 'node:crypto';
import {AgentRegistry,AgentIdentityStore,AgentRuntime,TaskStore,ContextAssembler,CapabilityDispatcher,defineCapability,PostgresWorkspaceStore,AssistantWorkspace,PeerReviews,WorkspaceReviewStore,createPeerReviewCapabilities,AssistantSettings,AssistantModels,ModelProfiles,TokenLedger} from '@immedi/iaic-core';
import {workspaceTools} from '@immedi/iaic-core/workspace/tools.js';

const denied=()=>Object.assign(new Error('Platform team access denied'),{statusCode:403});
const principal=actor=>JSON.stringify([actor.scopeId,actor.subjectId]);

// Application-owned composition; no new Core Runtime, role class or task table.
export async function openPlatformTeam({pool,applicationId,teamId,builtinActor,authorizeMember,profile,resolveSecret,tokenPolicy,verifyOutcome,version,skillRoot,modelFactory,workCapabilities=[]}){
 if(!/^[a-z][a-z0-9-]{0,50}$/.test(teamId)||builtinActor?.scopeId!==applicationId||!builtinActor.subjectId||[authorizeMember,resolveSecret,verifyOutcome].some(p=>typeof p!=='function')||!profile||profile.id!=='system'||!tokenPolicy||!version||!skillRoot)throw new Error('Explicit team, native identity, system model, allowance, verifier and version configuration required');
 const native=Object.freeze({...builtinActor}),nativeId=principal(native),definitionId='platform-'+teamId;
 const member=async actor=>Boolean(actor&&actor.scopeId===applicationId&&await authorizeMember(actor)===true);
 const check=async actor=>{if(!await member(actor))throw denied();};
 const checkNative=async actor=>{await check(actor);if(principal(actor)!==nativeId)throw denied();return true;};
 const budgetScope={applicationId,assistantId:definitionId,subjectId:'platform-development'};
 const resolveBudget=async actor=>{await checkNative(actor);return budgetScope;};
 const documents=new PostgresWorkspaceStore({pool}),settings=new AssistantSettings({pool}),ledger=new TokenLedger({pool}),identities=new AgentIdentityStore({pool}),tasks=new TaskStore({pool});
 for(const store of [documents,settings,ledger,identities])await store.initialize();
 const workspace=new AssistantWorkspace({store:documents,resolveScope:async actor=>{await check(actor);return {applicationId,assistantId:definitionId,subjectId:'team-work'};},sourceFor:actor=>({kind:'platform-team-work',author:principal(actor)})});
 // Reserved evidence is reachable only through the review service, not shared write tools.
 const serviceActor={scopeId:applicationId,subjectId:'review-service'};
 const evidence=new AssistantWorkspace({store:documents,resolveScope:async actor=>{if(actor!==serviceActor)throw denied();return {applicationId,assistantId:definitionId,subjectId:'review-evidence'};},sourceFor:()=>({kind:'platform-peer-review'})});
 const reviews=new PeerReviews({store:new WorkspaceReviewStore({workspace:evidence,actor:serviceActor}),resolvePrincipal:principal,authorize:member,readArtifact:async(actor,reference)=>{const artifact=await workspace.read(actor,reference);return {reference:artifact.reference,author:artifact.source.author};}});
 const tools=workspaceTools(workspace,native).filter(t=>['my_list_workspace','my_read_workspace','my_write_workspace'].includes(t.name)).map(tool=>defineCapability({name:tool.name,description:tool.description,input:tool.inputSchema,output:{type:'object'},effect:tool.name==='my_write_workspace'?'write':'read',...(tool.name==='my_write_workspace'?{retry:'never-replay'}:{}),authorize:member,...(tool.preflight?{preflight:tool.preflight}:{}),...(tool.projectHistoryInput?{projectHistoryInput:tool.projectHistoryInput}:{}),
  revalidate:async(input,result,{actor})=>tool.name==='my_list_workspace'?workspace.list(actor,input):workspace.read(actor,result.reference),
  implementation:{kind:'function',execute:(input,{actor})=>workspaceTools(workspace,actor).find(t=>t.name===tool.name).handler(input)}}));
 for(const capability of workCapabilities){
  if(capability.implementation?.kind!=='function')throw new Error('Additional team work capabilities must be existing function capabilities');
  tools.push(defineCapability({...capability,authorize:async(actor,input)=>await member(actor)&&await capability.authorize(actor,input)===true}));
 }
 tools.push(...createPeerReviewCapabilities({reviews}));
 const job={id:definitionId,role:'platform',purpose:'Develop and maintain the platform as a team, preserving concepts, evidence, documentation and finite version lifetimes.',capabilities:['platform.team.work'],configuration:{tools:tools.map(t=>t.name)}};
 const registry=new AgentRegistry({store:identities,definitions:[job],resolveScope:async actor=>{await checkNative(actor);return {applicationId,subjectId:native.subjectId};},authorizeStateChange:checkNative});
 const models=new AssistantModels({settings,profiles:new ModelProfiles({profiles:[profile],resolveSecret,...(modelFactory?{factory:modelFactory}:{})}),ledger,resolveScope:resolveBudget,tokenPolicies:{system:tokenPolicy}});
 const ref={type:'object',properties:{path:{type:'string'},revision:{type:'integer',minimum:1},digest:{type:'string',pattern:'^[a-f0-9]{64}$'}},required:['path','revision','digest'],additionalProperties:false};
 const agent=defineCapability({name:job.capabilities[0],description:job.purpose,input:{type:'object',properties:{goal:{type:'string',minLength:1,maxLength:16000},requestedBy:{type:'string',minLength:1}},required:['goal','requestedBy'],additionalProperties:false},output:{type:'object',properties:{summary:{type:'string',minLength:1,maxLength:8000},artifacts:{type:'array',items:ref,maxItems:20}},required:['summary','artifacts'],additionalProperties:false},effect:'write',retry:'never-replay',authorize:checkNative,implementation:{kind:'agent',
  instructions:'Work with your Platform AI teammates toward the requested goal. Discover and read shared artifacts before using them. Either member can execute work and review the other; do not assume a permanent observer/coder split. Use permitted tools and original effect receipts; do not repeat unknown effects. Update affected system documentation with code, evidence, limitations and migration instructions. Give replaced versions a finite lifetime without changing current concepts for indefinite compatibility. Treat peer reviews as opinions, not release approvals. Finish with {summary,artifacts}; cite exact shared artifact references. Ask for missing capabilities or information instead of inventing results.',tools:tools.map(t=>t.name),verify:async(input,result,context)=>{
   for(const reference of result.artifacts)await workspace.read(native,reference);
   return await verifyOutcome(input,result,context)===true;
  }}});
 const dispatcher=new CapabilityDispatcher({capabilities:[...tools,agent]});
 const runtime=new AgentRuntime({maxBatchCalls:4,store:tasks,dispatcher,model:{name:'system-profile-resolver'},resolveModel:request=>models.resolve(request),context:new ContextAssembler({skillRoot}),version,agentIdentity:{bind:({actor,capability})=>registry.bind(actor,definitionId,capability.name),check:({actor,task,binding})=>registry.check(actor,binding,task.capability)}});
 dispatcher.tasks=runtime;
 const key=(actor,requestId)=>'platform-team:'+createHash('sha256').update(JSON.stringify([applicationId,teamId,principal(actor),requestId])).digest('hex');
 const view=async(actor,id)=>{
  await check(actor);const task=await runtime.get(native,id,{history:true});
  if(task.agent?.definitionId!==definitionId)throw denied();
  // Sharing a team result does not confer the native executor's private tool rights.
  await runtime.context.revalidateHistory({history:task,actor,dispatcher});
  if(task.result?.artifacts)for(const reference of task.result.artifacts)await workspace.read(actor,reference);
  return {id:task.id,status:task.status,requestedBy:task.input.requestedBy,executor:nativeId,result:task.result??null};
 };
 const requestResult=async(actor,requestId)=>{
  await check(actor);const task=await tasks.findRequest(native,agent.name,key(actor,requestId));
  return task?{status:'recorded',task:await view(actor,task.id)}:{status:'unknown',task:null};
 };
 const requestKey={type:'string',minLength:1,maxLength:200};
 const publicCapabilities=[...tools,
  defineCapability({name:'platform.team.request',description:'Request native Platform AI work using its system model and platform development allowance. Your identity is retained as requester; execution remains native. Retain requestId after an uncertain acknowledgement.',input:{type:'object',properties:{requestId:requestKey,goal:agent.input.properties.goal},required:['requestId','goal'],additionalProperties:false},output:{type:'object'},effect:'write',retry:'idempotent',authorize:member,revalidate:(input,_result,{actor})=>requestResult(actor,input.requestId),implementation:{kind:'function',execute:async(input,{actor})=>{
   await check(actor);await dispatcher.invoke(agent.name,{goal:input.goal,requestedBy:principal(actor)},{actor:native,callId:key(actor,input.requestId)});return requestResult(actor,input.requestId);
  }}}),
  defineCapability({name:'platform.team.request_result',description:'Find your original native-work request. Unknown does not prove an in-flight request cannot commit; do not create another request ID to hide uncertainty.',input:{type:'object',properties:{requestId:requestKey},required:['requestId'],additionalProperties:false},output:{type:'object'},effect:'read',authorize:member,revalidate:(input,_result,{actor})=>requestResult(actor,input.requestId),implementation:{kind:'function',execute:(input,{actor})=>requestResult(actor,input.requestId)}}),
  defineCapability({name:'platform.team.task',description:'Read the currently shared native Task result and original requester/executor identities, without model transcripts.',input:{type:'object',properties:{id:{type:'string',pattern:'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'}},required:['id'],additionalProperties:false},output:{type:'object'},effect:'read',authorize:member,revalidate:(input,_result,{actor})=>view(actor,input.id),implementation:{kind:'function',execute:(input,{actor})=>view(actor,input.id)}})
 ];
 const publicDispatcher=new CapabilityDispatcher({capabilities:publicCapabilities});
 try{await runtime.initialize();}catch(error){await runtime.stop();throw error;}
 return {dispatcher:publicDispatcher,runtime,workspace,reviews,ledger,budgetScope,registry,models,start:()=>runtime.start(),close:()=>runtime.stop()};
}
