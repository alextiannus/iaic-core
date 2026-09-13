import fs from 'node:fs/promises';import {randomUUID} from 'node:crypto';import {fileURLToPath} from 'node:url';import {spawn} from 'node:child_process';import {isDeepStrictEqual} from 'node:util';import {Pool} from 'pg';
import {openApplication} from '@immedi/iaic-core/developer/templates/agent/app.mjs';import {actor,options,tools} from './config.mjs';
import {evidenceDigest} from '@immedi/iaic-core/evaluation/runner.js';
const out=process.env.IAIC_ACCEPTANCE_OUTPUT,connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;
if(process.env.IAIC_RUN_REAL_ACCEPTANCE!=='1'||!out||!process.env.IAIC_MODEL_API_KEY||!options.version||!process.env.IAIC_MODEL)throw new Error('Explicit actual-model opt-in, fresh output, source and credentials required');
if(!connectionString||!['127.0.0.1','localhost','[::1]'].includes(new URL(connectionString).hostname))throw new Error('Isolated local PostgreSQL required');
await fs.mkdir(out,{recursive:true,mode:0o700});
const clarificationMode=process.env.IAIC_CONTINUITY_CLARIFY==='1',memoryUpdate=process.env.IAIC_CONTINUITY_MEMORY_UPDATE==='1';
if(clarificationMode&&memoryUpdate)throw new Error('Select one authored scenario mode');
const runId=randomUUID(),project='Project-'+runId.slice(0,8),records=[{id:'A',state:'ready',units:7},{id:'B',state:'draft',units:90},{id:'C',state:'ready',units:11},...(clarificationMode?[{id:'D',state:'ready',units:4}]:[])],expected={project,selectedIds:clarificationMode?['A','D']:memoryUpdate?['A','C']:['C','A'],totalUnits:clarificationMode?11:18};
const clarification='Exclude record C. Sort selectedIds in ascending lexicographic order, overriding the saved preference. Keep this as a working draft.';
const updatedPreference='Sort selectedIds in ascending lexicographic order.';
const goal=(memoryUpdate?'First update my existing style memory exactly once to: '+updatedPreference+' This is an explicitly authorized lasting preference change; preserve the key style and use its current revision. Then ':'')+'Use the installed source-summary method, my style preference, the working guide and this session to prepare result.json. Read back the saved artifact, then finish. This is a working draft only.'+(clarificationMode?' Before preparing the artifact, ask me which record IDs to exclude and whether to override the saved ID sort order. These choices have not been provided. Do not write the artifact until I clarify.':'');
const frozen={runId,source:options.version,model:process.env.IAIC_MODEL,provider:process.env.IAIC_PROVIDER||'chat-completions',limits:options.runtimeLimits,toolScope:tools,graderRevision:memoryUpdate?'continuity-memory-update-v1':clarificationMode?'continuity-clarification-v1':'continuity-v2',project,records,expected,goal,...(memoryUpdate?{updatedPreference,expectedMemoryRevision:2}:{}),...(clarificationMode?{clarification}:{}),skillDigest:evidenceDigest(await fs.readFile(new URL('./skills/source-summary/SKILL.md',import.meta.url),'utf8')),independentHoldout:false};
await fs.writeFile(out+'/frozen.json',JSON.stringify(frozen,null,2),{flag:'wx',mode:0o600});
const schema='continuity_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let app;
try{
 app=await openApplication({pool,...options});
 await app.memory.remember(actor,{key:'style',kind:'preference',content:'Sort selectedIds in descending lexicographic order.',expectedRevision:0});
 await app.knowledgeStore.put({id:'working-guide',title:'Current source records',description:'Synthetic working records for a structured summary.',text:JSON.stringify(records),source:{kind:'synthetic-reference',reference:runId},policy:{organization:actor.scopeId},expectedRevision:0});
 const scope=await app.scope(actor);await app.ledger.grant(scope,{reference:'evaluation-only',amount:1000000,evidence:{fixture:true}});
 const session=await app.sessions.create(actor,{requestKey:'origin'});await app.sessions.appendMessage(actor,{sessionId:session.id,text:'The project identifier for this work is '+project+'.',requestKey:'project',expectedSequence:0});
 const task=await app.dispatcher.invoke('agent.work',{goal,requiredArtifacts:['result.json'],allowedTools:tools,session:{id:session.id,throughSequence:1}},{actor,callId:runId});
 await app.sessions.setState(actor,{sessionId:session.id,state:'closed',requestKey:'closed',expectedSequence:2});await app.close();app=null;
 // Each worker starts after the originating app/Session are closed.
 const runWorker=async()=>{
  const worker=spawn(process.execPath,[fileURLToPath(new URL('./worker.mjs',import.meta.url))],{env:{...process.env,IAIC_CONTINUITY_SCHEMA:schema},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';worker.stdout.on('data',d=>{stdout+=d;});worker.stderr.on('data',d=>{stderr+=d;});
  const exit=await new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('exit',(code,signal)=>resolve({code,signal}));});return {exit,stdout,stderr};
 };
 let {exit,stdout,stderr}=await runWorker(),clarificationEvidence=null;
 if(clarificationMode){
  app=await openApplication({pool,...options});const before=await app.tasks.get(actor,task.id),beforeHistory=await app.tasks.history(actor,task.id);
  clarificationEvidence={initialExit:exit,status:before.status,waitingReason:before.waiting_reason,noPrematureArtifact:!beforeHistory.calls.some(call=>call.capability==='my_write_workspace'&&call.status==='succeeded'),receipt:null,repeated:null};
  await fs.writeFile(out+'/before-clarification.json',JSON.stringify({task:before,history:beforeHistory,worker:{exit,stdout,stderr}},null,2),{flag:'wx',mode:0o600});
  if(exit.code===0&&before.status==='waiting'&&before.waiting_reason==='input'){
   // Inject a lost application acknowledgement after the accepted mutation.
   try{await app.dispatcher.invoke('tasks.provide_input',{id:task.id,input:clarification},{actor,callId:'clarification'});throw new Error('Injected lost clarification acknowledgement');}catch(error){if(error.message!=='Injected lost clarification acknowledgement')throw error;clarificationEvidence.acknowledgementLost=true;}
   await app.close();app=await openApplication({pool,...options});
   clarificationEvidence.receipt=await app.dispatcher.invoke('tasks.control_result',{id:task.id,requestKey:'clarification'},{actor});
   clarificationEvidence.repeated=await app.dispatcher.invoke('tasks.provide_input',{id:task.id,input:clarification},{actor,callId:'clarification'});
   await app.close();app=null;({exit,stdout,stderr}=await runWorker());
  }else{await app.close();app=null;}
 }
 app=await openApplication({pool,...options});const final=await app.tasks.get(actor,task.id),history=await app.tasks.history(actor,task.id),context=await app.sessions.context(actor,{id:session.id,throughSequence:2});
 let artifact=null,content=null;try{artifact=await app.workspace.read(actor,{path:'result.json'});content=JSON.parse(artifact.content);}catch(error){if(![404,undefined].includes(error.statusCode))throw error;}
 const pending=await app.ledger.pending(scope),balance=await app.ledger.balance(scope),successful=history.calls.filter(c=>c.status==='succeeded');
 const checks={worker_completed:exit.code===0,task_succeeded:final.status==='succeeded',content:isDeepStrictEqual(content,expected),skill_read:successful.some(c=>c.capability==='assistant.skills.read'),knowledge_read:successful.some(c=>c.capability==='my_read_knowledge'),memory_read:successful.some(c=>(c.capability==='my_read_assistant_memory'&&["Sort selectedIds in descending lexicographic order.",...(memoryUpdate?[updatedPreference]:[])].includes(c.result?.content))||(c.capability==='my_list_assistant_memories'&&Array.isArray(c.result)&&c.result.some(m=>m.memory_key==='style'&&["Sort selectedIds in descending lexicographic order.",...(memoryUpdate?[updatedPreference]:[])].includes(m.content)))),artifact_readback:successful.some(c=>c.capability==='my_read_workspace'),session_result:context.events.some(e=>e.kind==='task_ref'&&e.data.taskId===task.id&&e.data.status==='succeeded'),same_model:final.model===task.model,same_identity:isDeepStrictEqual(final.agent,task.agent),billing_settled:pending.length===0};
 if(memoryUpdate){const saved=await app.memory.read(actor,{key:'style'});checks.memory_updated_once=saved.content===updatedPreference&&saved.revision===2&&successful.filter(c=>c.capability==='my_remember_assistant_memory').length===1;}
 if(clarificationMode)Object.assign(checks,{asked_for_input:clarificationEvidence.status==='waiting'&&clarificationEvidence.waitingReason==='input',no_premature_artifact:clarificationEvidence.noPrematureArtifact,original_input_receipt:clarificationEvidence.receipt?.status==='confirmed'&&isDeepStrictEqual(clarificationEvidence.receipt.task,clarificationEvidence.repeated),one_clarification:history.events.filter(event=>event.kind==='input'&&event.data.text===clarification).length===1});
 const result={clarificationEvidence,runId,source:options.version,realModel:process.env.IAIC_CONTINUITY_FIXTURE!=='1',fullCoreAcceptance:false,independentHoldout:false,passed:Object.values(checks).every(Boolean),checks,taskId:task.id,status:final.status,waitingReason:final.waiting_reason,error:final.error,artifact:artifact?.reference,content,balance,pending,workerExit:exit,workerStdout:stdout,workerStderr:stderr,calls:history.calls,events:history.events,session:context};
 await fs.writeFile(out+'/result.json',JSON.stringify(result,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({runId,passed:result.passed,checks,status:final.status,providerResponses:history.events.filter(e=>e.kind==='model_usage').length,balance}));if(!result.passed)process.exitCode=1;
}finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
