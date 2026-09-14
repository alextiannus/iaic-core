import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {openUserAssistant,tools} from './application.mjs';
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL;assert.ok(connectionString);
const admin=new Pool({connectionString}),schema='user_demo_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let app;
const actor={scopeId:'demo',subjectId:'user-one'},other={scopeId:'demo',subjectId:'user-two'};
let granted=true,modelCalls=0;
const payloadSchema={type:'object',properties:{description:{type:'string'},capacity:{type:'integer',minimum:1}},required:['description','capacity'],additionalProperties:false};
const options={pool,authorize:a=>a.scopeId==='demo'&&['user-one','user-two'].includes(a.subjectId),authorizeSubmission:a=>granted&&a.subjectId==='user-one',payloadSchema,profile:{id:'system',provider:'openai',model:'user-companion-fixture',credentialRef:'fixture'},resolveSecret:()=> 'fixture-only',tokenPolicy:{maximum:100,price:{revision:'demo-units-v1',input:1,cachedInput:1,output:1}},resolveActor:req=>req.headers.get('authorization')==='Bearer demo-fixture'?actor:null,
 modelFactory:()=>({next:async({messages})=>{
  modelCalls++;const c=JSON.parse(messages.find(m=>m.role==='user').content),calls=c.calls.filter(x=>x.status==='succeeded');let action;
  assert.equal(c.agent.role,'user-assistant');
  if(calls.length===0)action={type:'call',name:'assistant.skills.read',input:{id:'declarations/SKILL.md'}};
  else if(calls.length===1)action={type:'call',name:'my_read_assistant_memory',input:{key:'reply-style'}};
  else if(calls.length===2){assert.equal(calls[1].result.content,'Brief and friendly');action={type:'call',name:'declarations.contract',input:{}};}
  else if(calls.length===3)action={type:'call',name:'my_write_workspace',input:{path:'declaration.json',content:JSON.stringify({description:'User supplied service',capacity:null}),expectedRevision:0}};
  else if(calls.length===4&&!c.events.some(e=>e.kind==='input'))action={type:'wait',question:'What capacity should your declaration state?'};
  else if(calls.length===4){assert.ok(c.events.some(e=>e.kind==='input'&&JSON.stringify(e.data).includes('12')));action={type:'call',name:'declarations.submit',input:{requestKey:'user-declaration-1',payload:{description:'User supplied service',capacity:12}}};}
  else if(calls.length===5)action={type:'call',name:'declarations.get',input:{requestKey:'user-declaration-1'}};
  else if(calls.length===6)action={type:'call',name:'my_write_workspace',input:{path:'declaration.json',content:JSON.stringify({description:'User supplied service',capacity:12}),expectedRevision:1}};
  else action={type:'finish',result:{summary:'Your declaration was submitted and its original receipt verified.',artifacts:[calls[6].result.reference]}};
  return {...action,usage:{inputTokens:1,outputTokens:1}};
 }})};
const invoke=(a,n,i,key)=>app.dispatcher.invoke(n,i,{actor:a,callId:key});
try{
 app=await openUserAssistant(options);
 await app.memory.remember(actor,{key:'reply-style',kind:'preference',content:'Brief and friendly',expectedRevision:0});
 await assert.rejects(app.memory.read(other,{key:'reply-style'}),{statusCode:404});
 const response=await app.http(new Request('http://demo/capabilities/agent.work',{method:'POST',headers:{authorization:'Bearer demo-fixture','content-type':'application/json'},body:JSON.stringify({requestKey:'conversation-1',input:{goal:'Submit my service declaration; ask me for missing fields.',allowedTools:tools,requiredArtifacts:['declaration.json']}})}));assert.equal(response.status,202);const task=(await response.json()).result;
 assert.equal((await app.runtime.tick()).status,'waiting');assert.equal(modelCalls,0);
 await app.ledger.grant(await app.scope(actor),{reference:'explicit-demo-budget',amount:1000,evidence:{fixture:true}});
 await invoke(actor,'tasks.resume',{id:task.id},'resume-budget');const debugWait=await app.runtime.tick();assert.equal(debugWait.status,'waiting');assert.equal(debugWait.waiting_reason,'input');
 assert.equal((await pool.query('SELECT * FROM demo_user_declarations')).rowCount,0);
 await app.close();app=await openUserAssistant(options);
 assert.equal((await app.memory.read(actor,{key:'reply-style'})).content,'Brief and friendly');
 assert.ok((await app.workspace.read(actor,{path:'declaration.json'})).content.includes('null'));
 await assert.rejects(invoke(other,'tasks.provide_input',{id:task.id,input:'999'},'foreign-input'));
 await invoke(actor,'tasks.provide_input',{id:task.id,input:'12'},'clarification-1');const finished=await app.runtime.tick();assert.equal(finished.status,'succeeded');
 const receipt=await invoke(actor,'declarations.get',{requestKey:'user-declaration-1'});assert.equal(receipt.principal.subjectId,actor.subjectId);
 assert.equal((await invoke(other,'declarations.get',{requestKey:'user-declaration-1'})).status,'unknown');
 const input={requestKey:'user-declaration-1',payload:{capacity:12,description:'User supplied service'}};
 await invoke(actor,'declarations.submit',input,'duplicate');assert.equal((await pool.query('SELECT * FROM demo_user_declarations')).rowCount,1);
 await assert.rejects(invoke(actor,'declarations.submit',{...input,payload:{...input.payload,capacity:20}},'changed'),{statusCode:409});
 granted=false;await assert.rejects(invoke(actor,'declarations.submit',{...input,requestKey:'revoked'},'revoked'),{statusCode:403});
 assert.ok(Number((await app.ledger.balance(await app.scope(actor))).balance)<1000);
 console.log(JSON.stringify({example:'core-user-assistant',userRole:true,privateMemory:true,progressiveSkills:true,privateWorkspace:true,clarificationAcrossReconstruction:true,hostPrincipalSubmission:true,deduplicatedReceipt:true,currentMandate:true,systemModelPlatformAllowance:true,modelMode:'deterministic',real12EatIntegration:false,ui:false}));
}finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
