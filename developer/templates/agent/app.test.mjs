import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';import {Pool} from 'pg';import {openApplication} from './app.mjs';import {fixtureOptions} from './fixture-model.mjs';
test('Queued Agent work survives a separate worker process with scoped resources, Session and pinned model',async()=>{
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Set SUBMISSION_TEST_DATABASE_URL to an isolated test database');
 const schema='agent_starter_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let app;
 try{
  app=await openApplication({pool,...fixtureOptions});const actor={subjectId:'fixture-user',scopeId:'fixture-org'};
  await app.memory.remember(actor,{key:'style',kind:'preference',content:'concise',expectedRevision:0});
  await app.knowledgeStore.put({id:'working-guide',title:'Guide',description:'Fixture reference',text:'verified source',source:{kind:'fixture',reference:'guide-v1'},policy:{organization:actor.scopeId},expectedRevision:0});
  await app.ledger.grant(await app.scope(actor),{reference:'fixture-grant',amount:1000,evidence:{fixture:true}});
  const session=await app.sessions.create(actor,{requestKey:'conversation'});await app.sessions.appendMessage(actor,{sessionId:session.id,text:'Prepare a draft for Project Aurora.',requestKey:'message',expectedSequence:0});
  const task=await app.dispatcher.invoke('agent.work',{goal:'Use my preference and the guide to prepare draft.md.',requiredArtifacts:['draft.md'],allowedTools:fixtureOptions.job.configuration.tools,session:{id:session.id,throughSequence:1}},{actor,callId:'draft-request'});
  await app.models.select(actor,{profileId:'alternate'});
  await app.sessions.setState(actor,{sessionId:session.id,state:'closed',requestKey:'close',expectedSequence:2});
  await app.close();app=null;
  const worker=`import {Pool} from 'pg';import {openApplication} from './app.mjs';import {fixtureOptions} from './fixture-model.mjs';const pool=new Pool({connectionString:process.env.SUBMISSION_TEST_DATABASE_URL,options:'-c search_path='+process.env.IAIC_TEST_SCHEMA});const app=await openApplication({pool,...fixtureOptions});try{const task=await app.runtime.tick();console.log(JSON.stringify({id:task.id,status:task.status,error:task.error,reason:task.waiting_reason}));}finally{await app.close();await pool.end();}`;
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',worker],{cwd:fileURLToPath(new URL('./',import.meta.url)),env:{...process.env,IAIC_TEST_SCHEMA:schema},timeout:30000});const completed=JSON.parse(stdout);assert.equal(completed.id,task.id);assert.equal(completed.status,'succeeded',stdout);
  app=await openApplication({pool,...fixtureOptions});const artifact=await app.workspace.read(actor,{path:'draft.md'});assert.deepEqual(JSON.parse(artifact.content),{style:'concise',guide:'verified source',model:'system',session:['Prepare a draft for Project Aurora.']});
  assert.equal((await app.models.snapshot(actor)).selectedProfile,'alternate');assert.equal((await app.ledger.balance(await app.scope(actor))).balance,'984');
  const current=await app.dispatcher.invoke('tasks.get',{id:task.id},{actor});assert.equal(current.status,'succeeded');assert.equal(current.result.artifacts[0].path,'draft.md');
  await assert.rejects(app.workspace.read({...actor,subjectId:'other'},{path:'draft.md'}),{statusCode:404});
  const context=await app.sessions.context(actor,{id:session.id,throughSequence:2});assert.equal(context.events.at(-1).data.status,'succeeded');
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
