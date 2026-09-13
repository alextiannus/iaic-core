import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {AgentIdentityStore,AgentRegistry,AgentRuntime,TaskStore,ContextAssembler,CapabilityDispatcher,createAgentTaskCapabilities,AssistantSettings,AssistantModels,ModelProfiles,TokenLedger,MemoryStore,AssistantMemory,PostgresWorkspaceStore,AssistantWorkspace} from '@immedi/iaic-core';
const connectionString=process.env.DATABASE_URL||process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL URL required');
const admin=new Pool({connectionString}),schema='composition_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let runtime;
try{
 const identities=new AgentIdentityStore({pool}),settings=new AssistantSettings({pool}),ledger=new TokenLedger({pool}),memoryStore=new MemoryStore({pool}),documents=new PostgresWorkspaceStore({pool});
 for(const store of [identities,settings,ledger,memoryStore,documents])await store.initialize();
 const roles=['user-assistant','business','platform'];
 const definitions=roles.map(role=>({id:role,role,purpose:'Prepare a scoped '+role+' draft.',capabilities:[role+'.work']}));
 // Trusted host identities, not a role supplied in model input.
 const actors=Object.fromEntries(roles.map(role=>[role,{scopeId:'composition-demo',subjectId:role}]));
 const registry=new AgentRegistry({store:identities,definitions,resolveScope:async actor=>({applicationId:actor.scopeId,subjectId:actor.subjectId}),authorizeStateChange:async()=>true});
 const modules={},capabilities=[],seen=[];
 for(const role of roles){
  const actor=actors[role],scope={applicationId:actor.scopeId,assistantId:role,subjectId:actor.subjectId};
  const resolveScope=async a=>{if(a.scopeId!==actor.scopeId||a.subjectId!==actor.subjectId)throw Object.assign(new Error('Denied'),{statusCode:403});return scope;};
  const memory=new AssistantMemory({store:memoryStore,resolveScope,sourceFor:()=>({kind:'user-request'})}),workspace=new AssistantWorkspace({store:documents,resolveScope,sourceFor:()=>({kind:'user-request'})});
  await memory.remember(actor,{key:'style',kind:'preference',content:role+' writing preference',expectedRevision:0});
  const profiles=new ModelProfiles({profiles:['standard','alternate'].map(id=>({id,provider:'openai',model:role+'-'+id,credentialRef:'fixture'})),resolveSecret:async()=> 'fixture-only',factory:({model})=>({next:async({messages})=>{
   const context=JSON.parse(messages[1].content);assert.equal(context.agent.role,role);seen.push({role,model});
   const calls=context.calls.filter(c=>c.status==='succeeded');let action;
   if(!calls.length)action={type:'call',name:role+'.my_read_assistant_memory',input:{key:'style'}};
   else if(calls.length===1){assert.equal(calls[0].result.content,role+' writing preference');action={type:'call',name:role+'.my_write_workspace',input:{path:'draft.md',content:role+' draft',mediaType:'text/markdown',expectedRevision:0}};}
   else action={type:'finish',result:{summary:'Prepared '+role+' draft.',artifacts:[calls[1].result.reference]}};
   return {...action,usage:{inputTokens:2,outputTokens:1}};
  }})});
  const models=new AssistantModels({settings,profiles,ledger,resolveScope,tokenPolicies:Object.fromEntries(['standard','alternate'].map(id=>[id,{maximum:100,price:{revision:'fixture-platform-units-v1',input:2,cachedInput:1,output:3}}]))});
  await ledger.grant(scope,{reference:'fixture-'+role,amount:1000,evidence:{fixture:true}});
  await models.select(actor,{profileId:'standard'});
  modules[role]={memory,workspace,models,scope};
  capabilities.push(...createAgentTaskCapabilities({name:role+'.work',toolNamespace:role,description:'Prepare a scoped '+role+' draft.',memory,workspace,authorize:async a=>a.scopeId===actor.scopeId&&a.subjectId===actor.subjectId,verifyOutcome:async(_input,result)=>result.artifacts.length===1&&(await workspace.read(actor,result.artifacts[0])).content===role+' draft'}));
 }
 const dispatcher=new CapabilityDispatcher({capabilities}),store=new TaskStore({pool});
 const agentIdentity={bind:({actor,capability})=>registry.bind(actor,actor.subjectId,capability.name),check:({actor,task,binding})=>registry.check(actor,binding,task.capability)};
 runtime=new AgentRuntime({store,dispatcher,model:{name:'resolver-required'},resolveModel:request=>modules[request.agent.definitionId].models.resolve(request),context:new ContextAssembler({skillRoot:process.cwd()}),version:'agent-composition-v1',agentIdentity});dispatcher.tasks=runtime;await runtime.initialize();
 // Admission rejects a foreign namespace and direct calls still check actor ownership.
 await assert.rejects(dispatcher.invoke('business.work',{goal:'Read',allowedTools:['platform.my_read_workspace']},{actor:actors.business,callId:'bad-scope'}),{statusCode:400});
 await assert.rejects(dispatcher.invoke('platform.my_read_workspace',{path:'draft.md'},{actor:actors.business}),{statusCode:403});
 const tasks=[];
 for(const role of roles)tasks.push(await dispatcher.invoke(role+'.work',{goal:'Read the writing preference and prepare a draft.',requiredArtifacts:['draft.md']},{actor:actors[role],callId:role}));
 // Model changes affect only this Agent's next task; admitted tasks keep their pinned model.
 await modules.business.models.select(actors.business,{profileId:'alternate',expectedRevision:1});
 for(const role of roles){assert.equal((await modules[role].models.snapshot(actors[role])).selectedProfile,role==='business'?'alternate':'standard');}
 for(let i=0;i<3;i++)assert.equal((await runtime.tick()).status,'succeeded');
 assert.ok(seen.every(entry=>entry.model===entry.role+'-standard'));
 assert.equal((await modules.business.models.resolve({actor:actors.business})).model,'business-alternate');
 assert.equal(new Set(tasks.map(task=>task.agent.instanceId)).size,3);
 for(const role of roles){
  const {workspace,scope}=modules[role];assert.equal((await workspace.read(actors[role],{path:'draft.md'})).content,role+' draft');
  assert.equal((await ledger.balance(scope)).balance,'979');assert.equal((await ledger.pending(scope)).length,0);
  assert.equal((await new AssistantSettings({pool}).get(scope)).model_profile,role==='business'?'alternate':'standard');
 }
 console.log(JSON.stringify({application:'core-agent-composition',roles,sameRuntime:true,independentResources:true,persistedIndependentModels:true,pinnedModelsPreserved:true,scopedPlatformAllowance:true,erpUsed:false,modelMode:'deterministic'}));
}finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
