import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';import {isDeepStrictEqual} from 'node:util';import {Pool} from 'pg';
import {AgentRuntime,TaskStore,ContextAssembler,CapabilityDispatcher,createAgentTaskCapabilities,defineCapability,TokenLedger,meteredModel,MemoryStore,AssistantMemory,PostgresWorkspaceStore,AssistantWorkspace,SkillCatalog,createModelProvider,EvaluationRunner,FileEvaluationStore,evaluateGate} from '@immedi/iaic-core';
import {evidenceDigest} from '@immedi/iaic-core/evaluation/runner.js';
const root=path.dirname(fileURLToPath(import.meta.url)),out=process.env.IAIC_ACCEPTANCE_OUTPUT;
if(process.env.IAIC_RUN_REAL_ACCEPTANCE!=='1'||!out||!process.env.IAIC_MODEL_API_KEY||!process.env.IAIC_MODEL||!process.env.IAIC_SOURCE_REVISION)throw new Error('Explicit real-model opt-in, output directory, credentials, model and source revision required');
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString||!['localhost','127.0.0.1','[::1]'].includes(new URL(connectionString).hostname))throw new Error('An isolated local PostgreSQL database is required');
await fs.mkdir(out,{recursive:true,mode:0o700});
const datasetPath=process.env.IAIC_ACCEPTANCE_DATASET||path.join(root,'dataset.json');
const dataset=JSON.parse(await fs.readFile(datasetPath,'utf8'));
const invocation=process.env.IAIC_MODEL_INVOCATION_JSON===undefined?undefined:JSON.parse(process.env.IAIC_MODEL_INVOCATION_JSON);
const sourceRecords=[{id:'R-01',region:'North',status:'ready',held:false,units:4},{id:'R-02',region:'South',status:'ready',held:false,units:5},{id:'R-03',region:'North',status:'ready',held:true,units:6},{id:'R-04',region:'South',status:'draft',held:false,units:9},{id:'R-05',region:'North',status:'ready',held:false,units:8},{id:'R-06',region:'South',status:'draft',held:true,units:7},{id:'R-07',region:'North',status:'ready',held:false,units:0}];
const skillRoot=path.join(root,'skills'),skillEntry='record-selection/SKILL.md',skillDigest=evidenceDigest(await fs.readFile(path.join(skillRoot,skillEntry),'utf8'));
const frozen={independentHoldout:false,...(invocation===undefined?{}:{invocation}),datasetDigest:evidenceDigest(dataset),skillDigest,sourceDigest:evidenceDigest(sourceRecords),model:process.env.IAIC_MODEL,provider:process.env.IAIC_PROVIDER||'openai',revision:process.env.IAIC_SOURCE_REVISION,maxTurns:10,maxCalls:8,maxBatchCalls:4,taskTimeoutMs:300000,requiredChecks:['task_succeeded','artifact_content','source_read','skill_read','memory_read','scope_preserved','billing_settled']};
await fs.writeFile(path.join(out,'dataset.json'),JSON.stringify(dataset,null,2),{flag:'wx',mode:0o600});
await fs.writeFile(path.join(out,'frozen.json'),JSON.stringify(frozen,null,2),{flag:'wx',mode:0o600});
const runner=new EvaluationRunner({
 execute:async({input,caseId,runId,signal})=>{
  const schema='real_composition_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);
  const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let runtime;
  try{
   const actor={scopeId:'synthetic-core-acceptance',subjectId:caseId},scope={applicationId:actor.scopeId,subjectId:actor.subjectId,assistantId:'worker'};
   const memoryStore=new MemoryStore({pool}),documents=new PostgresWorkspaceStore({pool}),ledger=new TokenLedger({pool});for(const store of [memoryStore,documents,ledger])await store.initialize();
   const memory=new AssistantMemory({store:memoryStore,resolveScope:()=>scope,sourceFor:()=>({kind:'synthetic-user-request'})}),workspace=new AssistantWorkspace({store:documents,resolveScope:()=>scope,sourceFor:()=>({kind:'synthetic-task'})});
   await memory.remember(actor,{key:'presentation',kind:'preference',content:'Sort selectedIds in descending lexicographic order.',expectedRevision:0});
   await workspace.write(actor,{path:'draft.json',content:JSON.stringify({selectedIds:['R-03','R-01'],totalUnits:10}),mediaType:'application/json',expectedRevision:0});
   const authorize=a=>a.scopeId===actor.scopeId&&a.subjectId===actor.subjectId;
   const records=defineCapability({name:'warehouse.records',description:'Read all current synthetic warehouse source records; interpret selection rules through installed methods.',input:{type:'object',properties:{},additionalProperties:false},output:{type:'array',items:{type:'object'}},effect:'read',authorize,revalidate:async()=>structuredClone(sourceRecords),implementation:{kind:'function',execute:async()=>structuredClone(sourceRecords)}});
   const skillCatalog=new SkillCatalog({root:skillRoot,entries:[skillEntry]});
   const capabilities=createAgentTaskCapabilities({memory,workspace,skillCatalog,authorize,extraCapabilities:[records],verifyOutcome:async(_input,result)=>result.artifacts.length===1});
   const dispatcher=new CapabilityDispatcher({capabilities});
   const provider=createModelProvider({apiKey:process.env.IAIC_MODEL_API_KEY,model:frozen.model,provider:frozen.provider,baseUrl:process.env.IAIC_MODEL_BASE_URL||'',maxOutputTokens:2048,invocation});
   await ledger.grant(scope,{reference:'acceptance-only',amount:1000000,evidence:{fixture:true}});
   const model=meteredModel({model:provider,ledger,scope,mode:'SYSTEM_MANAGED',policy:{maximum:100000,price:{revision:'synthetic-allowance-units-v1',input:1,cachedInput:1,output:1}}});
   runtime=new AgentRuntime({store:new TaskStore({pool}),dispatcher,model,context:new ContextAssembler({skillRoot,skillCatalog}),version:frozen.revision,maxTurns:frozen.maxTurns,maxCalls:frozen.maxCalls,maxBatchCalls:frozen.maxBatchCalls,modelTimeoutMs:60000,taskTimeoutMs:frozen.taskTimeoutMs});dispatcher.tasks=runtime;await runtime.initialize();
   const allowedTools=['warehouse.records','assistant.skills.list','assistant.skills.read','my_read_assistant_memory','my_list_assistant_memories','my_read_workspace','my_write_workspace'];
   const artifactPath=caseId==='correct-draft'?'draft.json':'result.json';
   const task=await dispatcher.invoke('assistant.run',{...input,requiredArtifacts:[artifactPath],allowedTools},{actor,callId:runId+':'+caseId});
   // Reconstruct after admission; this is continuity, not a process-kill claim.
   await runtime.stop();runtime=new AgentRuntime({...runtime,store:new TaskStore({pool})});dispatcher.tasks=runtime;await runtime.initialize();
   signal?.throwIfAborted();const final=await runtime.tick(),history=await runtime.store.history(actor,task.id);
   let artifact=null;try{artifact=await workspace.read(actor,{path:artifactPath});}catch(error){if(error.statusCode!==404)throw error;}
   let content=null;try{content=JSON.parse(artifact?.content);}catch{}
   const pending=await ledger.pending(scope),balance=await ledger.balance(scope);
   const observation=JSON.parse(JSON.stringify({taskId:task.id,status:final.status,waitingReason:final.waiting_reason,error:final.error,content,artifact:artifact?.reference??null,calls:history.calls,events:history.events,scopePreserved:history.calls.every(c=>allowedTools.includes(c.capability)),billingSettled:pending.length===0,balance,providerRequests:history.events.filter(e=>e.kind==='model_usage').length}));
   await fs.writeFile(path.join(out,caseId+'-trace.json'),JSON.stringify(observation,null,2),{flag:'wx',mode:0o600});
   return observation;
  }finally{await runtime?.stop();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
 },
 grade:async({testCase,observation:o})=>{
  const successful=o.calls.filter(c=>c.status==='succeeded');
  const checks=[['task_succeeded',o.status==='succeeded'],['artifact_content',isDeepStrictEqual(o.content,testCase.expected)],['source_read',successful.some(c=>c.capability==='warehouse.records')],['skill_read',successful.some(c=>c.capability==='assistant.skills.read'&&c.input.id===skillEntry)],['memory_read',successful.some(c=>(c.capability==='my_read_assistant_memory'&&c.input.key==='presentation')||(c.capability==='my_list_assistant_memories'&&Array.isArray(c.result)&&c.result.some(m=>m.memory_key==='presentation'&&m.content==='Sort selectedIds in descending lexicographic order.')))],['scope_preserved',o.scopePreserved],['billing_settled',o.billingSettled]].map(([name,passed])=>({name,passed}));
  return {passed:checks.every(c=>c.passed),score:checks.filter(c=>c.passed).length/checks.length,checks};
 },
 onRecord:async({runId,record})=>{await fs.appendFile(path.join(out,'records.ndjson'),JSON.stringify({runId,record})+'\n',{mode:0o600});console.log(JSON.stringify({caseId:record.caseId,status:record.status,passed:record.passed,checks:record.checks,providerRequests:record.observation?.providerRequests}));}
});
const run=await runner.run({dataset,revision:frozen.revision,graderRevision:'synthetic-selection-grader-v2',environmentRevision:evidenceDigest({...(invocation===undefined?{}:{invocation}),source:sourceRecords,skillDigest,preference:'descending',maxTurns:10,maxCalls:8,maxBatchCalls:4})});
const stored=await new FileEvaluationStore({directory:out}).put(run),gate=evaluateGate(run,{requiredChecks:frozen.requiredChecks});
await fs.writeFile(path.join(out,'result.json'),JSON.stringify({stored,gate,realModel:true,fullCoreAcceptance:false},null,2),{flag:'wx',mode:0o600});
console.log(JSON.stringify({runId:run.id,gate,realModel:true,fullCoreAcceptance:false}));if(!gate.passed)process.exitCode=1;
