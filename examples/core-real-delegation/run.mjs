import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {randomUUID,createHash} from 'node:crypto';import {isDeepStrictEqual} from 'node:util';import {Pool} from 'pg';
import {HandoffStore,TaskHandoffs,TaskStore,AgentRuntime,ContextAssembler,CapabilityDispatcher,defineCapability,createAgentTaskCapabilities,MemoryStore,AssistantMemory,PostgresWorkspaceStore,AssistantWorkspace,SkillCatalog,AgentRegistry,AgentIdentityStore,TokenLedger,meteredModel,createModelProvider} from '@immedi/iaic-core';
const root=path.dirname(fileURLToPath(import.meta.url)),out=process.env.IAIC_ACCEPTANCE_OUTPUT,fixture=process.env.IAIC_DELEGATION_FIXTURE==='1',revision=process.env.IAIC_SOURCE_REVISION;
if(!out||!revision||(!fixture&&(process.env.IAIC_RUN_REAL_ACCEPTANCE!=='1'||!process.env.IAIC_MODEL_API_KEY||!process.env.IAIC_MODEL)))throw Error('Output, source revision and fixture or explicit actual-model configuration required');
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString||!['localhost','127.0.0.1','[::1]'].includes(new URL(connectionString).hostname))throw Error('Isolated local PostgreSQL required');
const source=[{id:'A',status:'ready',held:false,units:7},{id:'B',status:'ready',held:true,units:11},{id:'C',status:'draft',held:false,units:13},{id:'D',status:'ready',held:false,units:5},{id:'E',status:'ready',held:false,units:0}];
const expected={selectedIds:source.filter(r=>r.status==='ready'&&!r.held&&r.units>0).map(r=>r.id).sort(),totalUnits:source.filter(r=>r.status==='ready'&&!r.held&&r.units>0).reduce((n,r)=>n+r.units,0)};
const toolNames=['assistant.skills.list','assistant.skills.read','source.records','my_write_workspace','my_read_workspace'];
const childGoal='Use the readiness Skill and raw source.records to produce readiness.json. Read it back and return its exact Artifact reference.';
const parentGoal='Delegate preparation of readiness.json to the specialist using the readiness Skill and current raw records. Wait for the child result, independently read its artifact and finish with its exact reference. Do not prepare the artifact yourself.';
const frozen={revision,model:fixture?'fixture':process.env.IAIC_MODEL,provider:process.env.IAIC_PROVIDER||'chat-completions',invocation:{parallelToolCalls:true},source,expected,parentGoal,childGoal,tools:toolNames,maxTurns:10,maxCalls:10,maxBatchCalls:4,childModelAdmissions:10,modelTimeoutMs:60000,taskTimeoutMs:300000,independentHoldout:false,fullCoreAcceptance:false,realModel:!fixture,skillDigest:createHash('sha256').update(await fs.readFile(path.join(root,'skills/readiness/SKILL.md'))).digest('hex')};
await fs.mkdir(out,{recursive:true,mode:0o700});await fs.writeFile(path.join(out,'frozen.json'),JSON.stringify(frozen,null,2),{flag:'wx',mode:0o600});
const actor={scopeId:'synthetic-delegation',subjectId:'owner'},scope={applicationId:actor.scopeId,subjectId:actor.subjectId,assistantId:'collaboration'},schema='real_delegation_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let runtime,evidenceResources;
try{
 const authorize=a=>a.scopeId===actor.scopeId&&a.subjectId===actor.subjectId;
 const tasks=new TaskStore({pool}),handoffStore=new HandoffStore({pool}),memoryStore=new MemoryStore({pool}),workspaceStore=new PostgresWorkspaceStore({pool}),identityStore=new AgentIdentityStore({pool}),ledger=new TokenLedger({pool});
 evidenceResources={tasks,ledger};
 for(const store of [handoffStore,memoryStore,workspaceStore,identityStore,ledger])await store.initialize();
 const memory=new AssistantMemory({store:memoryStore,resolveScope:()=>scope,sourceFor:()=>({kind:'fixture'})}),workspace=new AssistantWorkspace({store:workspaceStore,resolveScope:a=>{if(!authorize(a))throw Object.assign(Error('Scope denied'),{statusCode:403});return scope;},sourceFor:()=>({kind:'task-work'})});
 const skillCatalog=new SkillCatalog({root:path.join(root,'skills'),entries:['readiness/SKILL.md']});
 const registry=new AgentRegistry({store:identityStore,definitions:['coordinator','specialist'].map(id=>({id,purpose:id==='coordinator'?'Coordinate and verify delegated work':'Prepare source-backed readiness artifacts',capabilities:[id]})),resolveScope:a=>({applicationId:a.scopeId,subjectId:a.subjectId}),authorizeStateChange:authorize});
 let handoffs;const verify=async(_i,r,{actor,history})=>{
  const read=history.calls.find(c=>c.capability==='my_read_workspace'&&c.status==='succeeded'&&c.result?.reference?.path==='readiness.json');
  if(!read||r.artifacts.length!==1)return false;
  return isDeepStrictEqual(JSON.parse((await workspace.read(actor,r.artifacts[0])).content),expected);
 };
 const records=defineCapability({name:'source.records',description:'Read all current raw readiness records.',input:{type:'object',properties:{},additionalProperties:false},output:{type:'array',items:{type:'object'}},effect:'read',authorize,revalidate:async()=>structuredClone(source),implementation:{kind:'function',execute:async()=>structuredClone(source)}});
 const common={memory,workspace,skillCatalog,authorize,extraCapabilities:[records],verifyOutcome:verify};
 const childCaps=createAgentTaskCapabilities({...common,name:'specialist'}),parentCap=createAgentTaskCapabilities({...common,name:'coordinator',delegationTargets:['specialist']}).find(c=>c.name==='coordinator');
 const dispatcher=new CapabilityDispatcher({capabilities:[...childCaps,parentCap]});
 handoffs=new TaskHandoffs({store:handoffStore,resolveScope:a=>({applicationId:a.scopeId,subjectId:a.subjectId}),restoreActor:s=>({scopeId:s.applicationId,subjectId:s.subjectId}),authorize,attenuateInput:({input})=>input,readTask:(a,id)=>runtime.get(a,id,{history:true}),readTaskState:(a,id)=>runtime.state(a,id),admitTask:(a,name,input,key)=>dispatcher.invoke(name,input,{actor:a,callId:key}),findTask:(a,name,key)=>tasks.findRequest(a,name,key),cancelTask:(a,id)=>runtime.transition(a,id,{action:'cancel'}),capabilityFor:name=>dispatcher.capabilities.get(name),readArtifact:(a,ref)=>workspace.read(a,ref)});
 let providerCalls=0;
 const fixtureModel={name:'delegation-fixture',next:async request=>{
  const c=JSON.parse(request.messages.find(m=>m.role==='user').content),calls=c.calls.filter(x=>x.status==='succeeded');let action;
  if(request.delegationSchema){action={type:'delegate',input:{goal:childGoal,successCriteria:'Verified readiness.json according to the installed method, with its exact reference',tools:toolNames,requiredArtifacts:['readiness.json']}};}
  else if(c.handoffs?.items?.length){const ref=c.handoffs.items[0].result.artifacts[0];action=calls.length?{type:'finish',result:{summary:'Verified delegated readiness result',artifacts:[calls.at(-1).result.reference]}}:{type:'call',name:'my_read_workspace',input:ref};}
  else if(!calls.length)action={type:'call',name:'assistant.skills.list',input:{}};
  else if(calls.length===1)action={type:'call',name:'assistant.skills.read',input:{id:'readiness/SKILL.md'}};
  else if(calls.length===2)action={type:'call',name:'source.records',input:{}};
  else if(calls.length===3)action={type:'call',name:'my_write_workspace',input:{path:'readiness.json',content:JSON.stringify(expected),mediaType:'application/json',expectedRevision:0}};
  else if(calls.length===4)action={type:'call',name:'my_read_workspace',input:{path:'readiness.json'}};
  else action={type:'finish',result:{summary:'Readiness artifact verified',artifacts:[calls.at(-1).result.reference]}};
  return {...action,usage:{inputTokens:1,outputTokens:1}};
 }};
 const provider=fixture?fixtureModel:createModelProvider({apiKey:process.env.IAIC_MODEL_API_KEY,model:frozen.model,provider:frozen.provider,baseUrl:process.env.IAIC_MODEL_BASE_URL||'',maxOutputTokens:2048,invocation:frozen.invocation});
 const counted={name:provider.name,next:async request=>{providerCalls++;return provider.next(request);}};
 await ledger.grant(scope,{reference:'synthetic-collaboration-only',amount:2000000,evidence:{fixture:true}});
 const model=meteredModel({model:counted,ledger,scope,mode:'SYSTEM_MANAGED',policy:{maximum:100000,price:{revision:'fixture-platform-units-v1',input:1,cachedInput:1,output:1}}});
 const runtimeOptions={store:tasks,dispatcher,model,context:new ContextAssembler({skillRoot:path.join(root,'skills'),overflow:'omit-old-results',handoffProvider:({actor,task})=>task.handoff?null:handoffs.context(actor,task.id)}),version:revision,handoffs,agentIdentity:{bind:({actor,capability})=>registry.bind(actor,capability.name,capability.name),check:({actor,task,binding})=>registry.check(actor,binding,task.capability)},maxTurns:frozen.maxTurns,maxCalls:frozen.maxCalls,maxBatchCalls:frozen.maxBatchCalls,modelTimeoutMs:frozen.modelTimeoutMs,taskTimeoutMs:frozen.taskTimeoutMs};
 runtime=new AgentRuntime(runtimeOptions);dispatcher.tasks=runtime;await runtime.initialize();
 const parent=await dispatcher.invoke('coordinator',{goal:parentGoal,allowedTools:toolNames,requiredArtifacts:['readiness.json'],delegation:{capability:'specialist',maxModelCalls:frozen.childModelAdmissions,timeoutMs:frozen.taskTimeoutMs}},{actor,callId:'parent:'+randomUUID()});
 await fs.writeFile(path.join(out,'running.json'),JSON.stringify({schema,parentTaskId:parent.id}),{flag:'wx',mode:0o600});
 let reconstructed=false;
 for(let i=0;i<12;i++){
  const tick=await runtime.tick();const current=await tasks.get(actor,parent.id);await fs.appendFile(path.join(out,'progress.ndjson'),JSON.stringify({tick:i,taskId:tick?.id,status:tick?.status,parentStatus:current.status,providerCalls})+'\n',{mode:0o600});
  if(!reconstructed&&current.delegation){await runtime.stop();runtime=new AgentRuntime(runtimeOptions);dispatcher.tasks=runtime;await runtime.initialize();reconstructed=true;}
  if(['succeeded','failed','cancelled'].includes(current.status)||!tick||current.status==='waiting'&&current.waiting_reason!=='external_result')break;
 }
 const all=await tasks.list(actor),histories=await Promise.all(all.map(async t=>({task:t,history:await tasks.history(actor,t.id)}))),parentFinal=histories.find(h=>h.task.id===parent.id),child=histories.find(h=>h.task.handoff),links=await handoffs.context(actor,parent.id),pending=await ledger.pending(scope),balance=await ledger.balance(scope);let artifact=null,content=null;try{artifact=await workspace.read(actor,{path:'readiness.json'});content=JSON.parse(artifact.content);}catch(error){if(error.statusCode!==404)throw error;}
 const handoffReceipt=links.items[0]?await handoffs.read(actor,links.items[0].id):null;
 const childSuccess=child?.history.calls.filter(c=>c.status==='succeeded')??[],parentSuccess=parentFinal.history.calls.filter(c=>c.status==='succeeded');
 const checks=Object.entries({parent_succeeded:parentFinal.task.status==='succeeded',child_succeeded:child?.task.status==='succeeded',one_child:all.length===2,identity_distinct:Boolean(child?.task.agent?.instanceId&&parent.agent?.instanceId&&child.task.agent.instanceId!==parent.agent.instanceId),reconstructed,artifact_content:isDeepStrictEqual(content,expected),child_source_read:childSuccess.some(c=>c.capability==='source.records'),child_skill_read:childSuccess.some(c=>c.capability==='assistant.skills.read'),child_artifact_read:childSuccess.some(c=>c.capability==='my_read_workspace'),parent_artifact_read:parentSuccess.some(c=>c.capability==='my_read_workspace'&&isDeepStrictEqual(c.result.reference,artifact?.reference)),parent_did_not_write:!parentFinal.history.calls.some(c=>c.capability==='my_write_workspace'),scope_preserved:histories.every(h=>h.history.calls.every(c=>toolNames.includes(c.capability))),child_budget:!!handoffReceipt&&Number.isInteger(handoffReceipt.modelAdmissionsUsed)&&handoffReceipt.modelAdmissionsUsed<=frozen.childModelAdmissions,no_owner_resume:parentFinal.history.events.every(e=>e.kind!=='input'),result_reference:links.items.length===1&&isDeepStrictEqual(links.items[0].result?.artifacts,[artifact?.reference]),billing_settled:pending.length===0}).map(([name,passed])=>({name,passed}));
 const result={realModel:!fixture,independentHoldout:false,fullCoreAcceptance:false,revision,passed:checks.every(c=>c.passed),checks,parentTaskId:parent.id,providerCalls,reconstructed,artifact,content,histories,links,handoffReceipt,pending,balance};
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({passed:result.passed,checks,providerCalls,realModel:!fixture}));if(!result.passed)process.exitCode=1;
}catch(error){
 if(evidenceResources){try{const rows=await evidenceResources.tasks.list(actor),histories=await Promise.all(rows.map(async task=>({task,history:await evidenceResources.tasks.history(actor,task.id)})));await fs.writeFile(path.join(out,'failure-state.json'),JSON.stringify({histories,pending:await evidenceResources.ledger.pending(scope),balance:await evidenceResources.ledger.balance(scope)},null,2),{flag:'wx',mode:0o600});}catch(snapshotError){await fs.writeFile(path.join(out,'snapshot-failure.json'),JSON.stringify({message:snapshotError.message}),{flag:'wx',mode:0o600});}}
 await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({name:error.name,message:error.message}),{flag:'wx',mode:0o600});throw error;}
finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
