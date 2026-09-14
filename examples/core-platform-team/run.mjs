import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createCapabilityMcpServer} from '@immedi/iaic-core/mcp/server.js';
import {openPlatformTeam} from './application.mjs';

const connectionString=process.env.DATABASE_URL||process.env.SUBMISSION_TEST_DATABASE_URL;
if(!connectionString)throw new Error('Isolated PostgreSQL URL required');
const admin=new Pool({connectionString}),schema='platform_team_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let app,client,server;
const native={scopeId:'platform-host',subjectId:'builtin'},external={scopeId:'platform-host',subjectId:'external-codex-fixture'};
const principal=a=>JSON.stringify([a.scopeId,a.subjectId]);let modelCalls=0;
const members=new Set([principal(native),principal(external)]);
const options={pool,applicationId:native.scopeId,teamId:'core',builtinActor:native,authorizeMember:a=>members.has(principal(a)),profile:{id:'system',provider:'openai',model:'system-platform-fixture',credentialRef:'fixture'},resolveSecret:()=> 'fixture-only',tokenPolicy:{maximum:100,price:{revision:'platform-dev-units-v1',input:2,cachedInput:1,output:3}},version:'platform-team-v1',skillRoot:fileURLToPath(new URL('./',import.meta.url)),skillEntries:['skills/platform-maintenance/SKILL.md'],
 modelFactory:({model})=>({next:async({messages})=>{
  modelCalls++;assert.equal(model,'system-platform-fixture');
  const c=JSON.parse(messages[1].content),calls=c.calls.filter(call=>call.status==='succeeded');
  assert.equal(c.goal.requestedBy,principal(external));assert.equal(c.agent.role,'platform');let action;
  if(c.goal.goal==='Exercise own resources'){
   assert.equal(c.skills[0].id,'skills/platform-maintenance/SKILL.md');assert.equal(c.skills[0].text,undefined);
   if(calls.length===0)action={type:'call',name:'platform.self.assistant.skills.read',input:{id:c.skills[0].id,expectedVersion:c.skills[0].version}};
   else if(calls.length===1){assert.match(calls[0].result.text,/persistent|own memories/);action={type:'call',name:'platform.self.my_remember_assistant_memory',input:{key:'maintenance-lesson',kind:'note',content:'PRIVATE LESSON 17',expectedRevision:0}};}
   else if(calls.length===2)action={type:'call',name:'platform.self.my_write_workspace',input:{path:'private-draft.md',content:'PRIVATE SCRATCH 17',expectedRevision:0}};
   else if(calls.length===3&&!c.events.some(event=>event.kind==='input'))action={type:'wait',question:'Continue the resource exercise after restart?'};
   else if(calls.length===3)action={type:'call',name:'platform.self.my_read_assistant_memory',input:{key:'maintenance-lesson'}};
   else if(calls.length===4){assert.equal(calls[3].result.content,'PRIVATE LESSON 17');action={type:'call',name:'platform.self.my_read_workspace',input:{path:'private-draft.md'}};}
   else if(calls.length===5){assert.equal(calls[4].result.content,'PRIVATE SCRATCH 17');action={type:'call',name:'my_write_workspace',input:{path:'resource-result.md',content:'Own resources were recovered and checked.',expectedRevision:0}};}
   else action={type:'finish',result:{summary:'Published the intended resource result.',artifacts:[calls[5].result.reference]}};
   return {...action,usage:{inputTokens:2,outputTokens:1}};
  }
  if(c.goal.goal==='Recall in a later task'){
   if(!calls.length)action={type:'call',name:'platform.self.my_read_assistant_memory',input:{key:'maintenance-lesson'}};
   else {assert.equal(calls[0].result.content,'PRIVATE LESSON 17');action={type:'finish',result:{summary:'Recalled own persistent note in a new Task.',artifacts:[]}};}
   return {...action,usage:{inputTokens:2,outputTokens:1}};
  }
  if(!calls.length)action={type:'call',name:'my_read_workspace',input:{path:'external-change.md'}};
  else if(calls.length===1)action={type:'call',name:'my_write_workspace',input:{path:'native-plan.md',content:'Review the original receipt before continuing. Update affected system documentation and the replaced version lifetime.',expectedRevision:0}};
  else if(calls.length===2)action={type:'call',name:'collaboration.reviews.record',input:{id:'native-review',target:calls[0].result.reference,verdict:'changes_requested',findings:'The change needs original effect verification and migration documentation.'}};
  else if(calls.length===3)action={type:'call',name:'collaboration.reviews.read',input:{id:'native-review'}};
  else if(!c.events.some(event=>event.kind==='input'))action={type:'wait',question:'Which migration deadline should the plan use?'};
  else action={type:'finish',result:{summary:'Reviewed the teammate change and retained a maintenance plan.',artifacts:[calls[1].result.reference]}};
  return {...action,usage:{inputTokens:2,outputTokens:1}};
 }}),verifyOutcome:async(input,result,{history})=>input.goal==='Exercise own resources'?history.calls.some(c=>c.capability==='my_write_workspace'&&c.input.path==='resource-result.md'&&c.status==='succeeded'):input.goal==='Recall in a later task'?history.calls.some(c=>c.capability==='platform.self.my_read_assistant_memory'&&c.result.content==='PRIVATE LESSON 17'):result.artifacts.length===1&&history.calls.some(c=>c.capability==='collaboration.reviews.read'&&c.status==='succeeded'&&c.result.reviewer===principal(native))};
try{
 app=await openPlatformTeam(options);
 const userScope={applicationId:native.scopeId,assistantId:'personal-assistant',subjectId:external.subjectId};
 await app.ledger.grant(userScope,{reference:'user-fixture',amount:1000,evidence:{fixture:true}});
 await app.dispatcher.invoke('my_write_workspace',{path:'external-change.md',content:'External work awaiting peer review.',expectedRevision:0},{actor:external,callId:'external-draft'});
 const request={requestId:'one-work-item',goal:'Review external-change.md, propose remaining work and update the relevant documentation plan.'};
 await assert.rejects(app.dispatcher.invoke('platform.team.request',{...request,requestedBy:principal(native)},{actor:external,callId:'spoof-requester'}),{statusCode:400});
 const queued=await app.dispatcher.invoke('platform.team.request',request,{actor:external,callId:'request'});
 assert.equal(queued.status,'recorded');assert.equal(queued.task.requestedBy,principal(external));assert.equal(queued.task.executor,principal(native));
 assert.equal((await app.dispatcher.invoke('platform.team.request',request,{actor:external,callId:'request-again'})).task.id,queued.task.id);
 await assert.rejects(app.dispatcher.invoke('platform.team.request',{...request,goal:'Different goal'},{actor:external,callId:'changed-request'}),{statusCode:409});
 const waiting=await app.runtime.tick();assert.equal(waiting.status,'waiting');assert.equal(modelCalls,0);
 assert.equal((await app.ledger.balance(userScope)).balance,'1000');
 // Platform work cannot borrow the funded personal-assistant allowance.
 await app.ledger.grant(app.budgetScope,{reference:'platform-dev-fixture',amount:1000,evidence:{fixture:true}});
 await app.dispatcher.invoke('platform.team.tasks.resume',{id:queued.task.id},{actor:external,callId:'funded-resume'});
 await app.close();app=await openPlatformTeam(options);
 assert.equal((await app.runtime.tick()).status,'waiting');
 server=createCapabilityMcpServer({dispatcher:app.dispatcher,resolveAccess:async()=>({actor:external,capabilities:[...app.dispatcher.capabilities.keys()]})});
 client=new Client({name:'external-platform-fixture',version:'1'});const [ct,st]=InMemoryTransport.createLinkedPair();await server.connect(st);await client.connect(ct);
 const call=async(name,input,requestKey)=>{const result=await client.callTool({name,arguments:{input,...(requestKey?{requestKey}:{})}});assert.notEqual(result.isError,true,JSON.stringify(result));return JSON.parse(result.content[0].text);};
 const question=await call('platform.team.task',{id:queued.task.id});
 assert.equal(question.waitingReason,'input');assert.match(question.inputRequest.question,/migration deadline/);
 await call('platform.team.tasks.provide_input',{id:queued.task.id,input:'Use the documented finite version support deadline.'},'answer-deadline');
 // Lost acknowledgements recover the original transition instead of inserting another input.
 await call('platform.team.tasks.provide_input',{id:queued.task.id,input:'Use the documented finite version support deadline.'},'answer-deadline');
 assert.equal((await call('platform.team.tasks.control_result',{id:queued.task.id,requestKey:'answer-deadline'})).status,'confirmed');
 assert.equal((await app.runtime.tick()).status,'succeeded');
 const finished=await call('platform.team.task',{id:queued.task.id});assert.equal(finished.status,'succeeded');assert.equal(finished.requestedBy,principal(external));
 const original=await call('platform.team.request_result',{requestId:request.requestId});assert.equal(original.task.id,queued.task.id);
 const review=await call('collaboration.reviews.read',{id:'native-review'});assert.equal(review.author,principal(external));
 const reverse=await call('collaboration.reviews.record',{id:'external-review',target:finished.result.artifacts[0],verdict:'inconclusive',findings:'Execute this plan against actual work before claiming completion.'},'external-review');assert.equal(reverse.author,principal(native));
 assert.equal((await app.reviews.read(native,reverse.id)).reviewer,principal(external));
 assert.equal((await app.ledger.balance(userScope)).balance,'1000');assert.equal((await app.ledger.balance(app.budgetScope)).balance,'958');assert.equal((await app.ledger.pending(app.budgetScope)).length,0);
 // The same request key is scoped to its actual requester; either member can originate work.
 const nativeRequest=await app.dispatcher.invoke('platform.team.request',request,{actor:native,callId:'native-request'});
 assert.notEqual(nativeRequest.task.id,queued.task.id);assert.equal(nativeRequest.task.requestedBy,principal(native));
 await assert.rejects(app.dispatcher.invoke('platform.team.tasks.cancel',{id:nativeRequest.task.id},{actor:external,callId:'wrong-requester'}),{statusCode:403});
 await app.dispatcher.invoke('platform.team.tasks.cancel',{id:nativeRequest.task.id},{actor:native,callId:'native-cancel'});
 const privateTools=(await client.listTools()).tools.filter(tool=>tool.name.startsWith('platform.self.'));assert.equal(privateTools.length,0);
 const resourceTask=await call('platform.team.request',{requestId:'own-resources',goal:'Exercise own resources'},'own-resources');
 assert.equal((await app.runtime.tick()).status,'waiting');
 await client.close();client=null;await server.close();server=null;await app.close();app=await openPlatformTeam(options);
 await assert.rejects(app.self.memory.read(external,{key:'maintenance-lesson'}),{statusCode:403});
 await assert.rejects(app.self.workspace.read(external,{path:'private-draft.md'}),{statusCode:403});
 await assert.rejects(app.workspace.read(external,{path:'private-draft.md'}),{statusCode:404});
 await assert.rejects(app.self.skills.list({actor:external}),{statusCode:403});
 await app.dispatcher.invoke('platform.team.tasks.provide_input',{id:resourceTask.task.id,input:'Continue.'},{actor:external,callId:'resume-own-resources'});
 assert.equal((await app.runtime.tick()).status,'succeeded');
 const shared=await app.dispatcher.invoke('platform.team.task',{id:resourceTask.task.id},{actor:external});
 assert.equal(shared.status,'succeeded');assert.doesNotMatch(JSON.stringify(shared),/PRIVATE LESSON|PRIVATE SCRATCH/);
 assert.equal((await app.workspace.read(external,shared.result.artifacts[0])).content,'Own resources were recovered and checked.');
 await app.dispatcher.invoke('platform.team.request',{requestId:'later-resource-recall',goal:'Recall in a later task'},{actor:external,callId:'later-resource-recall'});
 assert.equal((await app.runtime.tick()).status,'succeeded');
 assert.equal((await app.ledger.balance(userScope)).balance,'1000');assert.equal((await app.ledger.balance(app.budgetScope)).balance,'888');
 members.delete(principal(external));
 await assert.rejects(app.dispatcher.invoke('platform.team.task',{id:queued.task.id},{actor:external}),{statusCode:403});
 console.log(JSON.stringify({application:'core-platform-team',modelMode:'deterministic',systemProfile:true,separatePlatformBudget:true,platformUnits:112,userAllowanceUnchanged:true,persistentNativeTask:true,requesterAndExecutorRetained:true,reciprocalReview:true,externalMcp:true,clarificationAndResume:true,ownMemoryAfterRestart:true,ownMemoryAcrossTasks:true,privateWorkspace:true,progressiveSkills:true,liveCodex:false,taskTakeover:false}));
}finally{await client?.close();await server?.close();await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
