import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';import {Pool} from 'pg';import {openApplication} from './app.mjs';import {fixtureOptions} from './fixture-model.mjs';import {createTaskObservationSource} from '@immedi/iaic-core';
test('Generated event work recovers original queue admission and preserves event scope across reconstruction',async()=>{
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');
 const schema='event_starter_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let app;
 try{
  const actor={subjectId:'event-owner',scopeId:'event-org'},job=structuredClone(fixtureOptions.job);job.configuration.tools.push('my_read_assistant_event');let calls=0,builds=0,allowed=true;
  const options={pool,...fixtureOptions,job,authorize:a=>allowed&&a.subjectId===actor.subjectId&&a.scopeId===actor.scopeId,scheduling:{restoreActor:()=>actor},
   eventWork:{sourceFor:()=>({kind:'fixture-event'}),buildTask:()=>{builds++;return {goal:'Read the original event and return its value',allowedTools:['my_read_assistant_event']};}},
   modelFactory:()=>({next:async({messages})=>{calls++;const context=JSON.parse(messages.find(m=>m.role==='user').content),read=context.calls.find(c=>c.status==='succeeded');return {...(read?{type:'finish',result:{summary:String(read.result.data.value),artifacts:[]}}:{type:'call',name:'my_read_assistant_event',input:{key:context.goal.sourceEventKey}}),usage:{inputTokens:1,outputTokens:1}};}}),
   verifyOutcome:async(input,result,{actor,history})=>{const event=await app.events.read(actor,{key:input.sourceEventKey});return result.summary===String(event.data.value)&&history.calls.some(c=>c.capability==='my_read_assistant_event'&&c.status==='succeeded'&&c.result.id===event.id);}};
  app=await openApplication(options);await app.ledger.grant(await app.scope(actor),{reference:'event-funding',amount:1000,evidence:{fixture:true}});
  await app.eventSubscriptions.subscribe(actor,{key:'incoming',prefix:'input:'});assert.equal((await app.eventTasks.tick(actor,{key:'incoming'})).handled.length,0);assert.equal(calls,0);
  const event=await app.events.publish(actor,{key:'input:one',data:{value:42,allowedTools:['my_forget_assistant_memory'],goal:'Untrusted payload is not the host work instruction'}});
  const schedule=app.deferred.schedule.bind(app.deferred);app.deferred.schedule=async(...args)=>{await schedule(...args);throw Object.assign(new Error('Lost queue acknowledgement'),{outcomeUnknown:true});};
  await assert.rejects(app.eventTasks.tick(actor,{key:'incoming'}),{outcomeUnknown:true});assert.equal(builds,1);assert.equal(calls,0);await app.close();app=null;app=await openApplication(options);
  const consumed=await app.eventTasks.tick(actor,{key:'incoming'});assert.equal(consumed.handled.length,1);assert.equal(builds,1);assert.equal(consumed.handled[0].eventId,event.id);
  const receipt=await app.deferred.tick(),task=await app.tasks.get(actor,receipt.taskId);assert.deepEqual(task.input.allowedTools,['my_read_assistant_event']);assert.equal(task.input.sourceEventKey,event.key);
  assert.equal((await app.runtime.tick()).status,'succeeded');assert.equal(calls,2);assert.equal((await app.tasks.list(actor)).length,1);assert.equal((await app.ledger.balance(await app.scope(actor))).balance,'996');
  assert.equal((await app.eventTasks.tick(actor,{key:'incoming'})).handled.length,0);
  const prior=await app.eventSubscriptions.status(actor,{key:'incoming'});await app.events.publish(actor,{key:'input:two',data:{value:7}});allowed=false;
  await assert.rejects(app.eventTasks.tick(actor,{key:'incoming'}),{statusCode:403});allowed=true;assert.equal((await app.eventSubscriptions.status(actor,{key:'incoming'})).cursor,prior.cursor);assert.equal(calls,2);
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
test('Generated scheduled work preserves receipts, current model and restored owner across reconstruction',async()=>{
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');
 const schema='schedule_starter_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let app;
 try{
  const actor={subjectId:'scheduled-owner',scopeId:'scheduled-org'},job=structuredClone(fixtureOptions.job);let calls=0,wrongOwner=false;
  job.configuration.tools.push('assistant.schedule','my_get_scheduled_assistant_task','my_list_scheduled_assistant_tasks','my_cancel_scheduled_assistant_task');
  const options={pool,...fixtureOptions,job,scheduling:{restoreActor:()=>({...actor,...(wrongOwner?{subjectId:'other'}:{})})},modelFactory:()=>({next:async()=>{calls++;return {type:'finish',result:{summary:'42',artifacts:[]},usage:{inputTokens:1,outputTokens:1}};}}),verifyOutcome:async(_i,r)=>Number(r.summary)===17+25};
  app=await openApplication(options);await app.ledger.grant(await app.scope(actor),{reference:'scheduled-funding',amount:1000,evidence:{fixture:true}});
  const session=await app.sessions.create(actor,{requestKey:'origin'});
  const input={dueAt:'2000-01-01T00:00:00Z',task:{goal:'Compute 17 plus 25',allowedTools:['my_list_assistant_memories'],session:{id:session.id,throughSequence:0}}};
  const intent=await app.dispatcher.invoke('assistant.schedule',input,{actor,callId:'schedule-original'});assert.equal(calls,0);assert.equal(intent.state,'queued');
  await app.sessions.setState(actor,{sessionId:session.id,state:'closed',requestKey:'close',expectedSequence:0});
  await app.models.select(actor,{profileId:'alternate'});await app.close();app=null;app=await openApplication(options);
  const repeated=await app.dispatcher.invoke('assistant.schedule',input,{actor,callId:'schedule-original'});assert.equal(repeated.id,intent.id);
  const receipt=await app.deferred.tick();assert.equal(receipt.state,'dispatched');assert.equal(calls,0);assert.equal(await app.deferred.tick(),null);
  const task=await app.tasks.get(actor,receipt.taskId);assert.ok(task.model.startsWith('alternate:'));assert.equal((await app.runtime.tick()).status,'succeeded');assert.equal(calls,1);
  assert.equal((await app.ledger.balance(await app.scope(actor))).balance,'998');assert.equal((await app.tasks.list(actor)).length,1);
  const context=await app.sessions.context(actor,{id:session.id,throughSequence:2});assert.ok(context.events.some(e=>e.kind==='task_ref'&&e.data.taskId===task.id&&e.data.status==='succeeded'));
  const future=await app.dispatcher.invoke('assistant.schedule',{...input,dueAt:'2099-01-01T00:00:00Z'},{actor,callId:'future'});assert.equal(await app.deferred.tick(),null);
  assert.equal((await app.dispatcher.invoke('my_cancel_scheduled_assistant_task',{id:future.id},{actor,callId:'cancel-future'})).state,'cancelled');
  const blocked=await app.dispatcher.invoke('assistant.schedule',input,{actor,callId:'wrong-owner'});wrongOwner=true;assert.equal((await app.deferred.tick()).state,'blocked');assert.equal(calls,1);
  assert.equal((await app.deferred.get(actor,blocked.id)).taskId,null);
  app.start();assert.ok(app.runtime.timer);assert.ok(app.deferred.timer);await app.close();assert.equal(app.runtime.timer,null);assert.equal(app.deferred.timer,null);app=null;
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
test('Generated app optionally restores editable Task plans into the model context',async()=>{
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');
 const schema='plan_starter_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let app;
 try{
  const actor={subjectId:'plan-user',scopeId:'plan-org'},job=structuredClone(fixtureOptions.job);job.configuration.tools.push('tasks.plan.read','tasks.plan.update');
  const options={pool,...fixtureOptions,job,enablePlans:true,modelFactory:()=>({next:async({messages})=>{
   const data=JSON.parse(messages.find(m=>m.role==='user').content);assert.equal(data.plan.revision,1);assert.equal(data.plan.steps[0].description,'Review proposed work');
   return {type:'finish',result:{summary:'Plan restored',artifacts:[]},usage:{inputTokens:1,outputTokens:1}};
  }}),verifyOutcome:async(_i,r)=>r.summary==='Plan restored'};
  app=await openApplication(options);await app.ledger.grant(await app.scope(actor),{reference:'plan-fixture',amount:1000,evidence:{fixture:true}});
  const task=await app.dispatcher.invoke('agent.work',{goal:'Read the saved plan',allowedTools:job.configuration.tools},{actor,callId:'planned-task'});
  await app.dispatcher.invoke('tasks.plan.update',{id:task.id,expectedRevision:0,steps:[{id:'review',description:'Review proposed work',status:'pending'}]},{actor,callId:'plan-update'});
  await app.close();app=null;app=await openApplication(options);
  assert.equal((await app.runtime.tick()).status,'succeeded');assert.equal((await app.dispatcher.invoke('tasks.plan.read',{id:task.id},{actor})).revision,1);
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
test('Queued Agent work survives a separate worker process with scoped resources, Session and pinned model',async()=>{
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Set SUBMISSION_TEST_DATABASE_URL to an isolated test database');
 const schema='agent_starter_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let app;
 try{
  app=await openApplication({pool,...fixtureOptions,taskCursorKey:Buffer.alloc(32,7)});const actor={subjectId:'fixture-user',scopeId:'fixture-org'};
  await app.memory.remember(actor,{key:'style',kind:'preference',content:'concise',expectedRevision:0});
  await app.knowledgeStore.put({id:'working-guide',title:'Guide',description:'Fixture reference',text:'verified source',source:{kind:'fixture',reference:'guide-v1'},policy:{organization:actor.scopeId},expectedRevision:0});
  await app.ledger.grant(await app.scope(actor),{reference:'fixture-grant',amount:1000,evidence:{fixture:true}});
  const session=await app.sessions.create(actor,{requestKey:'conversation'});await app.sessions.appendMessage(actor,{sessionId:session.id,text:'Prepare a draft for Project Aurora.',requestKey:'message',expectedSequence:0});
  const task=await app.dispatcher.invoke('agent.work',{goal:'Use my preference and the guide to prepare draft.md.',requiredArtifacts:['draft.md'],allowedTools:fixtureOptions.job.configuration.tools,session:{id:session.id,throughSequence:1}},{actor,callId:'draft-request'});
  await app.models.select(actor,{profileId:'alternate'});
  await app.sessions.setState(actor,{sessionId:session.id,state:'closed',requestKey:'close',expectedSequence:2});
  await app.close();app=null;
  const worker=`import {Pool} from 'pg';import {openApplication} from './app.mjs';import {fixtureOptions} from './fixture-model.mjs';import {createTaskObservationSource} from '@immedi/iaic-core';const pool=new Pool({connectionString:process.env.SUBMISSION_TEST_DATABASE_URL,options:'-c search_path='+process.env.IAIC_TEST_SCHEMA});const app=await openApplication({pool,...fixtureOptions,taskCursorKey:Buffer.alloc(32,7)});try{const task=await app.runtime.tick();console.log(JSON.stringify({id:task.id,status:task.status,error:task.error,reason:task.waiting_reason}));}finally{await app.close();await pool.end();}`;
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',worker],{cwd:fileURLToPath(new URL('./',import.meta.url)),env:{...process.env,IAIC_TEST_SCHEMA:schema},timeout:30000});const completed=JSON.parse(stdout);assert.equal(completed.id,task.id);assert.equal(completed.status,'succeeded',stdout);
  app=await openApplication({pool,...fixtureOptions,taskCursorKey:Buffer.alloc(32,7)});const artifact=await app.workspace.read(actor,{path:'draft.md'});assert.deepEqual(JSON.parse(artifact.content),{style:'concise',guide:'verified source',model:'system',session:['Prepare a draft for Project Aurora.']});
  assert.equal((await app.dispatcher.invoke('tasks.list',{status:'succeeded',limit:1},{actor})).items[0].id,task.id);
  assert.equal((await app.models.snapshot(actor)).selectedProfile,'alternate');assert.equal((await app.ledger.balance(await app.scope(actor))).balance,'984');
  const source=createTaskObservationSource({tasks:app.tasks,ledger:app.ledger,resolveContext:async()=>({actor,taskId:task.id,billingScope:await app.scope(actor)}),resolveRelease:()=>({releaseId:'fixture-app',manifestDigest:'a'.repeat(64)})});
  const observed=await source('finished-task',{sourceScope:'fixture'});assert.equal(observed.confirmed,true);assert.equal(observed.record.providerTokens,'16');assert.equal(observed.record.platformUnits,'16');assert.equal(observed.record.success,true);
  const current=await app.dispatcher.invoke('tasks.get',{id:task.id},{actor});assert.equal(current.status,'succeeded');assert.equal(current.result.artifacts[0].path,'draft.md');
  await assert.rejects(app.workspace.read({...actor,subjectId:'other'},{path:'draft.md'}),{statusCode:404});
  const unfunded={...actor,subjectId:'no-allowance'};await app.memory.remember(unfunded,{key:'style',kind:'preference',content:'concise',expectedRevision:0});
  const pending=await app.dispatcher.invoke('agent.work',{goal:'Prepare draft.md.',requiredArtifacts:['draft.md'],allowedTools:fixtureOptions.job.configuration.tools},{actor:unfunded,callId:'unfunded-task'});
  assert.equal((await app.runtime.tick()).waiting_reason,'token_balance');
  await app.ledger.grant(await app.scope(unfunded),{reference:'explicit-fixture-funding',amount:1000,evidence:{fixture:true}});
  await app.dispatcher.invoke('tasks.resume',{id:pending.id},{actor:unfunded,callId:'resume-after-funding'});assert.equal((await app.runtime.tick()).status,'succeeded');
  const context=await app.sessions.context(actor,{id:session.id,throughSequence:2});assert.equal(context.events.at(-1).data.status,'succeeded');
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});

test('Generated app composes explicit routing, shared rate/capacity and original metering after reconstruction',async()=>{
 const {PostgresModelRateLimits,rateLimitedModel,PostgresModelCapacity,capacityModel}=await import('@immedi/iaic-core');
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw Error('Isolated PostgreSQL required');
 const schema='routed_starter_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let app;
 try{
  const rates=new PostgresModelRateLimits({pool,namespace:'fixture-account',requestsPerMinute:100,tokensPerMinute:1000}),capacity=new PostgresModelCapacity({pool,namespace:'fixture-account',maxConcurrent:1});await rates.initialize();await capacity.initialize();
  let primaryAvailable=false,allowed=true;
  const options={pool,...fixtureOptions,routing:{resolvePolicy:async()=>allowed?{revision:'fixture-routes',profileIds:['system','alternate']}:null,availability:async({profile})=>profile.id==='system'&&!primaryAvailable?'unavailable':'available'},modelFactory:config=>rateLimitedModel({rates,maximumTokens:()=>2,model:capacityModel({capacity,model:fixtureOptions.modelFactory(config)})})};
  const actor={subjectId:'fixture-user',scopeId:'fixture-org'};
  app=await openApplication(options);await app.memory.remember(actor,{key:'style',kind:'preference',content:'concise'});
  await app.knowledgeStore.put({id:'working-guide',title:'Guide',description:'Fixture',text:'verified source',source:{kind:'fixture',reference:'guide'},policy:{organization:actor.scopeId},expectedRevision:0});
  await app.ledger.grant(await app.scope(actor),{reference:'fixture-funding',amount:1000,evidence:{fixture:true}});
  const input={goal:'Create and verify draft.md.',requiredArtifacts:['draft.md'],allowedTools:fixtureOptions.job.configuration.tools};
  const task=await app.dispatcher.invoke('agent.work',input,{actor,callId:'routed-work'});assert.ok(task.model.startsWith('alternate:'));
  await app.close();app=null;primaryAvailable=true;app=await openApplication(options);
  assert.equal((await app.runtime.tick()).status,'succeeded');assert.equal(JSON.parse((await app.workspace.read(actor,{path:'draft.md'})).content).model,'alternate');
  assert.equal((await app.ledger.balance(await app.scope(actor))).balance,'984');assert.equal((await capacity.pending()).items.length,0);
  const receipts=(await pool.query('SELECT state,actual_tokens FROM iaic_model_rate_reservations')).rows;assert.equal(receipts.length,8);assert.ok(receipts.every(r=>r.state==='settled'&&r.actual_tokens==='2'));
  const fresh=await app.dispatcher.invoke('agent.work',input,{actor,callId:'fresh-work'});assert.ok(fresh.model.startsWith('system:'));await app.runtime.transition(actor,fresh.id,{action:'cancel'});
  allowed=false;await assert.rejects(app.dispatcher.invoke('agent.work',input,{actor,callId:'denied-work'}),{statusCode:403});
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});

test('Generated HTTP entry supports clarification, original receipts and current Task discovery',async()=>{
 const {createServer}=await import('node:http'),{once}=await import('node:events'),{CapabilityHttpClient}=await import('@immedi/iaic-core/http/client.js'),{createApplicationHttpHandler}=await import('./http.mjs');
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');
 const schema='http_starter_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let app,server;
 try{
 const actor={subjectId:'http-owner',scopeId:'http-org'};let allowed=true;
 app=await openApplication({pool,...fixtureOptions,taskCursorKey:Buffer.alloc(32,8),authorize:a=>allowed&&a.subjectId===actor.subjectId&&a.scopeId===actor.scopeId,
  modelFactory:()=>({next:async({messages})=>{const data=JSON.parse(messages[1].content);const action=!data.calls.length?{type:'call',name:'my_list_assistant_memories',input:{}}:!data.events.some(e=>e.kind==='input')?{type:'wait',question:'Which format should I use?'}:{type:'finish',result:{summary:'Confirmed format',artifacts:[]}};return {...action,usage:{inputTokens:1,outputTokens:1}};}}),
  verifyOutcome:async(_input,result,{history})=>result.summary==='Confirmed format'&&history.events.some(e=>e.kind==='input'&&e.data.text==='Plain text')});
 await app.ledger.grant(await app.scope(actor),{reference:'http-fixture',amount:1000,evidence:{fixture:true}});
 const handler=createApplicationHttpHandler({app,job:fixtureOptions.job,resolveActor:request=>request.headers.get('authorization')==='Bearer fixture'?actor:null});
 server=createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const response=await handler(new Request('http://localhost'+req.url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500).end();}});server.listen(0,'127.0.0.1');await once(server,'listening');
 const client=new CapabilityHttpClient({url:'http://127.0.0.1:'+server.address().port+'/capabilities',headers:()=>({authorization:'Bearer fixture'})});
 const names=(await client.list()).map(c=>c.name);for(const name of ['tasks.state','tasks.provide_input','tasks.control_result','tasks.list'])assert.ok(names.includes(name),name);
 assert.ok(!names.includes('my_forget_assistant_memory'));
 const task=(await client.invoke('agent.work',{goal:'Read my preferences and confirm format',allowedTools:['my_list_assistant_memories']},{requestKey:'new-task'})).result;
 assert.equal((await app.runtime.tick()).waiting_reason,'input');const view=(await client.invoke('tasks.get',{id:task.id})).result;assert.equal(view.inputRequest.question,'Which format should I use?');
 const input={id:task.id,input:'Plain text'};const original=(await client.invoke('tasks.provide_input',input,{requestKey:'clarification'})).result;
 const receipt=(await client.invoke('tasks.control_result',{id:task.id,requestKey:'clarification'})).result;assert.equal(receipt.status,'confirmed');assert.deepEqual(receipt.task,original);
 assert.equal((await app.runtime.tick()).status,'succeeded');assert.deepEqual((await client.invoke('tasks.provide_input',input,{requestKey:'clarification'})).result,original);
 assert.equal((await client.invoke('tasks.state',{id:task.id})).result.status,'succeeded');assert.equal((await client.invoke('tasks.list',{status:'succeeded'})).result.items[0].id,task.id);
 assert.equal((await app.tasks.history(actor,task.id)).events.filter(e=>e.kind==='input').length,1);
 allowed=false;await assert.rejects(client.invoke('tasks.get',{id:task.id}),{statusCode:403});
 await assert.rejects(new CapabilityHttpClient({url:client.url}).list(),{statusCode:403});
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});

test('Generated Mandates survive reconstruction and stop revoked work before subsequent effects',async()=>{
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');
 const schema='mandate_starter_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let app;
 try{
  const actor={subjectId:'mandate-owner',scopeId:'mandate-org'},job=structuredClone(fixtureOptions.job);job.configuration.tools.push('assistant.schedule');let calls=0,revokeDuringModel=false,grantId;
  const options={pool,...fixtureOptions,job,scheduling:{restoreActor:()=>actor},
   mandates:{authorizeGrant:a=>a.subjectId===actor.subjectId,sourceFor:()=>({kind:'owner-instruction',reference:'fixture-grant'})},
   modelFactory:()=>({next:async()=>{calls++;if(revokeDuringModel){await app.mandates.revoke(actor,grantId);return {type:'call',name:'my_write_workspace',input:{path:'must-not-exist.md',content:'blocked',expectedRevision:0},usage:{inputTokens:1,outputTokens:1}};}return {type:'finish',result:{summary:'42',artifacts:[]},usage:{inputTokens:1,outputTokens:1}};}}),verifyOutcome:async(_i,r)=>Number(r.summary)===17+25};
  app=await openApplication(options);await app.ledger.grant(await app.scope(actor),{reference:'mandate-funding',amount:1000,evidence:{fixture:true}});
  const terms={requestKey:'owner-grant',capability:'agent.work',tools:['my_write_workspace'],purpose:'Authorized fixture work',expiresAt:'2099-01-01T00:00:00Z'};
  await assert.rejects(app.mandates.grant({...actor,subjectId:'other'},terms),{statusCode:403});
  const grant=await app.mandates.grant(actor,terms);grantId=grant.id;
  const input={goal:'Compute 17 plus 25',allowedTools:['my_write_workspace'],mandate:{id:grant.id}};
  await assert.rejects(app.dispatcher.invoke('agent.work',{...input,allowedTools:['my_read_workspace']},{actor,callId:'too-broad'}),{statusCode:403});
  await app.dispatcher.invoke('agent.work',input,{actor,callId:'authorized-task'});
  await app.close();app=null;app=await openApplication(options);
  assert.equal((await app.mandates.grant(actor,terms)).id,grant.id);assert.equal((await app.runtime.tick()).status,'succeeded');assert.equal(calls,1);
  const next=await app.dispatcher.invoke('agent.work',input,{actor,callId:'revoke-inflight'});
  const scheduled=await app.dispatcher.invoke('assistant.schedule',{dueAt:'2000-01-01T00:00:00Z',task:input},{actor,callId:'scheduled-mandate'});
  revokeDuringModel=true;assert.equal((await app.runtime.tick()).status,'waiting');assert.equal(calls,2);
  await assert.rejects(app.workspace.read(actor,{path:'must-not-exist.md'}),{statusCode:404});assert.equal((await app.tasks.history(actor,next.id)).calls.length,0);
  assert.equal((await app.ledger.balance(await app.scope(actor))).balance,'996');
  await app.close();app=null;app=await openApplication(options);
  assert.ok((await app.mandates.read(actor,grant.id)).revokedAt);
  await assert.rejects(app.runtime.transition(actor,next.id,{action:'resume'}),{statusCode:403});
  await assert.rejects(app.dispatcher.invoke('agent.work',input,{actor,callId:'revoked-new'}),{statusCode:403});
  assert.equal((await app.deferred.tick()).state,'blocked');assert.equal((await app.deferred.get(actor,scheduled.id)).taskId,null);assert.equal(calls,2);
  assert.equal((await app.tasks.list(actor)).length,2);
  assert.equal((await app.runtime.transition(actor,next.id,{action:'cancel'})).status,'cancelled');
  assert.ok(![...app.dispatcher.capabilities.keys()].some(name=>name.includes('mandate')));
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});

test('Generated Agent invokes an independently owned domain Capability with shared authorization and outcome checks',async()=>{
 const {defineCapability}=await import('@immedi/iaic-core');
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');
 const schema='domain_starter_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let app;
 try{
  await pool.query('CREATE TABLE application_totals(owner text PRIMARY KEY,value integer NOT NULL)');await pool.query("INSERT INTO application_totals VALUES('domain-owner',15)");
  const actor={subjectId:'domain-owner',scopeId:'domain-org'},job=structuredClone(fixtureOptions.job);job.configuration.tools.push('domain.add');let executions=0,modelCalls=0;
  const read=async()=>Number((await pool.query('SELECT value FROM application_totals WHERE owner=$1',[actor.subjectId])).rows[0].value);
  const domain=defineCapability({name:'domain.add',description:'Add an authorized amount to the application-owned total',input:{type:'object',properties:{amount:{type:'integer',minimum:1,maximum:100}},required:['amount'],additionalProperties:false},output:{type:'object',properties:{value:{type:'integer'}},required:['value'],additionalProperties:false},effect:'write',retry:'never-replay',authorize:(a,i)=>a.subjectId===actor.subjectId&&a.scopeId===actor.scopeId&&i.amount<=30,revalidate:async()=>({value:await read()}),implementation:{kind:'function',execute:async(input,{actor})=>{executions++;return (await pool.query('UPDATE application_totals SET value=value+$1 WHERE owner=$2 RETURNING value',[input.amount,actor.subjectId])).rows[0];}}});
  const options={pool,...fixtureOptions,job,extraCapabilities:[domain],modelFactory:()=>({next:async({messages})=>{modelCalls++;const c=JSON.parse(messages.find(m=>m.role==='user').content);return {...(c.calls.length?{type:'finish',result:{summary:String(c.calls[0].result.value),artifacts:[]}}:{type:'call',name:'domain.add',input:{amount:27}}),usage:{inputTokens:1,outputTokens:1}};}}),verifyOutcome:async(_i,r,{history})=>r.summary==='42'&&await read()===42&&history.calls.some(c=>c.capability==='domain.add'&&c.status==='succeeded')};
  app=await openApplication(options);
  await assert.rejects(app.dispatcher.invoke('domain.add',{amount:31},{actor,callId:'denied-amount'}),{statusCode:403});await assert.rejects(app.dispatcher.invoke('domain.add',{amount:1},{actor:{...actor,subjectId:'other'},callId:'denied-owner'}),{statusCode:403});assert.equal(executions,0);
  await app.ledger.grant(await app.scope(actor),{reference:'domain-fixture',amount:1000,evidence:{fixture:true}});
  const task=await app.dispatcher.invoke('agent.work',{goal:'Add 27 to my application total and verify 42',allowedTools:['domain.add']},{actor,callId:'domain-work'});
  await app.close();app=null;app=await openApplication(options);
  assert.equal((await app.runtime.tick()).status,'succeeded');assert.equal((await app.runtime.get(actor,task.id)).result.summary,'42');assert.equal(await read(),42);assert.equal(executions,1);assert.equal(modelCalls,2);assert.equal((await app.ledger.balance(await app.scope(actor))).balance,'996');
  const {createApplicationHttpHandler}=await import('./http.mjs'),{CapabilityHttpClient}=await import('@immedi/iaic-core');
  const handler=createApplicationHttpHandler({app,job,resolveActor:()=>actor}),client=new CapabilityHttpClient({url:'https://application.test/capabilities',fetch:(url,init)=>handler(new Request(url,init))});
  assert.ok((await client.list()).some(c=>c.name==='domain.add'));await assert.rejects(client.invoke('domain.add',{amount:31},{requestKey:'http-denied'}),{statusCode:403});assert.equal(executions,1);
  await app.close();app=null;const without=structuredClone(job);without.configuration.tools=without.configuration.tools.filter(n=>n!=='domain.add');app=await openApplication({...options,job:without});
  await assert.rejects(app.dispatcher.invoke('domain.add',{amount:1},{actor,callId:'not-in-job'}),{statusCode:403});assert.equal(executions,1);
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});

test('Generated Agent binds evaluated releases across reconstruction and blocks stopped responses before effects',async()=>{
 const {EvaluationRunner,ReleaseManager,PostgresReleaseStore}=await import('@immedi/iaic-core');
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');
 const schema='release_starter_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let app;
 try{
  const actor={subjectId:'release-worker',scopeId:'release-org'},maintainer={subjectId:'release-maintainer',scopeId:actor.scopeId},records=new Map(),policies={};
  const runner=new EvaluationRunner({execute:({input})=>({result:input}),grade:({testCase,observation})=>({passed:observation.result===testCase.expected,score:observation.result===testCase.expected?1:0,checks:[{name:'outcome',passed:observation.result===testCase.expected}]})});
  for(const suite of ['capability','regression'])for(const revision of ['baseline','candidate']){
   const run=await runner.run({dataset:[{id:suite,category:'outcome',input:suite==='capability'?42:17,expected:suite==='capability'?42:17}],revision,graderRevision:'fixture-grader',environmentRevision:'fixture-environment'});records.set(suite+'-'+revision,run);
   if(revision==='baseline')policies[suite]={datasetDigest:run.datasetDigest,graderRevision:run.graderRevision,environmentRevision:run.environmentRevision,repeats:1,baselineId:suite+'-baseline',thresholds:{requiredChecks:['outcome']}};
  }
  const store=new PostgresReleaseStore({pool,namespace:'generated-release'});await store.initialize();
  const releases=new ReleaseManager({store,evaluations:{get:async id=>structuredClone(records.get(id))},policies,authorize:(a,{action})=>a.scopeId===actor.scopeId&&(a.subjectId===maintainer.subjectId||(['check','resolve'].includes(action)&&a.subjectId===actor.subjectId)),resolveCohort:a=>a.subjectId});
  for(const id of ['baseline','candidate'])await releases.register(maintainer,{manifest:{id,implementationRevision:id,versions:Object.fromEntries(['prompt','model','skills','tools','knowledge','harness'].map(k=>[k,'fixture-'+id]))},evaluations:{capability:'capability-'+id,regression:'regression-'+id}});
  await releases.setChannel(maintainer,{name:'main',stableId:'baseline',expectedRevision:0});await releases.setChannel(maintainer,{name:'main',stableId:'baseline',canaryId:'candidate',percentage:100,expectedRevision:1});
  const selected=await releases.resolve(actor,'main');let calls=0,stopDuringModel=false;
  const options={pool,...fixtureOptions,version:'candidate',releaseBinding:{releases,reference:selected,implementationRevision:'candidate'},modelFactory:()=>({next:async()=>{calls++;if(stopDuringModel){await releases.stop(maintainer,'candidate');return {type:'call',name:'my_write_workspace',input:{path:'stopped.md',content:'must not be written',expectedRevision:0},usage:{inputTokens:1,outputTokens:1}};}return {type:'finish',result:{summary:'42',artifacts:[]},usage:{inputTokens:1,outputTokens:1}};}}),verifyOutcome:async(_i,r)=>Number(r.summary)===17+25};
  await assert.rejects(openApplication({...options,version:'unmatched'}),/Release binding must match/);
  app=await openApplication(options);await app.ledger.grant(await app.scope(actor),{reference:'release-funding',amount:1000,evidence:{fixture:true}});
  const input={goal:'Compute 17 plus 25',allowedTools:['my_write_workspace']};
  const first=await app.dispatcher.invoke('agent.work',input,{actor,callId:'candidate-first'});const binding=(await app.tasks.get(actor,first.id)).agent;
  assert.equal(binding.release.releaseId,'candidate');await app.close();app=null;app=await openApplication(options);
  assert.equal((await app.runtime.tick()).status,'succeeded');assert.equal(calls,1);assert.deepEqual((await app.tasks.get(actor,first.id)).agent,binding);
  const interrupted=await app.dispatcher.invoke('agent.work',input,{actor,callId:'candidate-stop'});stopDuringModel=true;
  assert.equal((await app.runtime.tick()).status,'waiting');assert.equal(calls,2);assert.equal((await app.tasks.history(actor,interrupted.id)).calls.length,0);
  await assert.rejects(app.workspace.read(actor,{path:'stopped.md'}),{statusCode:404});await assert.rejects(releases.stop(actor,'baseline'),{statusCode:403});
  await assert.rejects(app.dispatcher.invoke('agent.work',input,{actor,callId:'stopped-admission'}),{statusCode:409});
  assert.equal((await app.ledger.balance(await app.scope(actor))).balance,'996');
  await app.close();app=null;const fallback=await releases.resolve(actor,'main');assert.equal(fallback.releaseId,'baseline');stopDuringModel=false;
  app=await openApplication({...options,version:'baseline',releaseBinding:{releases,reference:fallback,implementationRevision:'baseline'}});
  await assert.rejects(app.runtime.transition(actor,interrupted.id,{action:'resume'}),{statusCode:409});
  const next=await app.dispatcher.invoke('agent.work',input,{actor,callId:'fallback-new'});assert.equal((await app.runtime.tick()).status,'succeeded');assert.equal(calls,3);
  assert.equal((await app.tasks.get(actor,next.id)).agent.release.releaseId,'baseline');assert.equal((await app.tasks.get(actor,interrupted.id)).agent.release.releaseId,'candidate');
  assert.equal((await app.ledger.balance(await app.scope(actor))).balance,'994');assert.ok(![...app.dispatcher.capabilities.keys()].some(n=>n.startsWith('releases.')));
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
