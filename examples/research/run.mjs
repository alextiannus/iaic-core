import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {randomUUID,createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {Pool} from 'pg';
import {AgentRuntime,TaskStore,ContextAssembler,CapabilityDispatcher,PostgresWorkspaceStore,AssistantWorkspace,TokenLedger,meteredModel,createModelProvider} from '@immedi/iaic-core';
import {researchCapabilities} from './application.js';
const root=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(root,'../..');
if(process.env.IAIC_RUN_REAL_ACCEPTANCE!=='1')throw new Error('Paid model execution requires IAIC_RUN_REAL_ACCEPTANCE=1');
const output=process.env.IAIC_ACCEPTANCE_OUTPUT,connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;
if(!output||!path.isAbsolute(output)||!connectionString||!['localhost','127.0.0.1','[::1]'].includes(new URL(connectionString).hostname))throw new Error('New absolute evidence directory and isolated local PostgreSQL URL required');
if(!process.env.IAIC_MODEL_API_KEY||!process.env.IAIC_MODEL)throw new Error('Explicit model and provider credential required');
const source=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
if(execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim())throw new Error('Commit and freeze the checkout before paid execution');
const documents=JSON.parse(await fs.readFile(path.join(root,'documents.json'),'utf8')),cases=JSON.parse(await fs.readFile(path.join(root,'cases.json'),'utf8'));
await fs.mkdir(output,{mode:0o700});
const freeze={source,at:new Date().toISOString(),model:process.env.IAIC_MODEL,provider:process.env.IAIC_PROVIDER||'chat-completions',endpoint:process.env.IAIC_MODEL_BASE_URL||'',repetitions:3,expectedRuns:9,modelTimeoutMs:300000,taskTimeoutMs:900000,maxTurns:20,maxCalls:16,maxOutputBytes:32000,maxOutputTokens:16384,invocation:{toolChoice:'auto',parallelToolCalls:false},developerAuthored:true,independentHumanReview:false,hashes:{}};
for(const file of ['application.js','run.mjs','documents.json','cases.json','skills/research.md']){const bytes=await fs.readFile(path.join(root,file));freeze.hashes[file]=createHash('sha256').update(bytes).digest('hex');await fs.mkdir(path.dirname(path.join(output,'frozen',file)),{recursive:true});await fs.writeFile(path.join(output,'frozen',file),bytes,{flag:'wx',mode:0o600});}
await fs.writeFile(path.join(output,'freeze.json'),JSON.stringify(freeze,null,2),{flag:'wx',mode:0o600});
// One schema and executor per batch, retained even on failure for unknown reconciliation.
const schema='research_'+randomUUID().replaceAll('-','');const admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);await admin.end();
await fs.writeFile(path.join(output,'database.json'),JSON.stringify({schema,retained:true}),{flag:'wx',mode:0o600});
const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let runtime;
try{
 const documentStore=new PostgresWorkspaceStore({pool}),ledger=new TokenLedger({pool});await documentStore.initialize();await ledger.initialize();
 const actor={scopeId:schema,subjectId:'research-reader'},scope={applicationId:schema,subjectId:actor.subjectId,assistantId:'research'};
 const workspace=new AssistantWorkspace({store:documentStore,resolveScope:a=>{if(a.scopeId!==actor.scopeId||a.subjectId!==actor.subjectId)throw Object.assign(new Error('Denied'),{statusCode:403});return scope;},sourceFor:()=>({kind:'synthetic-research'})});
 const capabilities=researchCapabilities({documents,workspace,canRead:a=>a.scopeId===actor.scopeId&&a.subjectId===actor.subjectId});
 const dispatcher=new CapabilityDispatcher({capabilities});
 const provider=createModelProvider({apiKey:process.env.IAIC_MODEL_API_KEY,model:freeze.model,provider:freeze.provider,baseUrl:freeze.endpoint,maxOutputTokens:freeze.maxOutputTokens,invocation:freeze.invocation});
 await ledger.grant(scope,{reference:'synthetic-acceptance',amount:50000000,evidence:{fixture:true}});
 const model=meteredModel({model:provider,ledger,scope,mode:'SYSTEM_MANAGED',policy:{maximum:1000000,price:{revision:'synthetic-platform-units-v1',input:2,cachedInput:1,output:6}}});
 runtime=new AgentRuntime({store:new TaskStore({pool}),dispatcher,model,context:new ContextAssembler({skillRoot:root}),version:source,maxTurns:freeze.maxTurns,maxCalls:freeze.maxCalls,modelTimeoutMs:freeze.modelTimeoutMs,taskTimeoutMs:freeze.taskTimeoutMs});dispatcher.tasks=runtime;await runtime.initialize();
 for(const testCase of cases)for(let repetition=0;repetition<3;repetition++){
  const started=Date.now();const task=await dispatcher.invoke('research.prepare',testCase.input,{actor,callId:testCase.id+'-'+repetition});const final=await runtime.tick();const history=await runtime.store.history(actor,task.id);
  let artifact=null;if(final.status==='succeeded')artifact=await workspace.read(actor,final.result.reference);
  const record={caseId:testCase.id,category:testCase.category,repetition,taskId:task.id,status:final.status,error:final.error,waitingReason:final.waiting_reason,elapsedMs:Date.now()-started,artifact,history,pendingUsage:await ledger.pending(scope),balance:await ledger.balance(scope),semanticAccepted:null};
  await fs.appendFile(path.join(output,'runs.ndjson'),JSON.stringify(record)+'\n',{mode:0o600});console.log(JSON.stringify({caseId:testCase.id,repetition,status:final.status,semanticAccepted:null}));
 }
 await fs.writeFile(path.join(output,'execution-terminal.json'),JSON.stringify({at:new Date().toISOString(),expectedRuns:9,semanticAcceptance:'pending independent content review',schemaRetained:true}),{flag:'wx',mode:0o600});
}finally{await runtime?.stop();await pool.end();}
