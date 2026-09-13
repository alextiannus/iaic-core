import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {spawn} from 'node:child_process';import {once} from 'node:events';import {fileURLToPath} from 'node:url';
import {PostgresMonitorCycles,PersistentReleaseMonitor,createMonitorCycleCapabilities,PostgresObservationStore,PostgresReleaseStore,ReleaseManager,ReleaseObservation,ReleaseMonitor,createReleaseMonitorCapability,createObservationCapabilities} from '@immedi/iaic-core';
const actor={subjectId:'operator'},ref={releaseId:'candidate',manifestDigest:'a'.repeat(64)};
const policy={revision:'guard1',fallbackId:'stable',minSamples:1,maxErrorRate:0,maxMeanLatencyMs:1000,windowMs:10000,maxAssessmentAgeMs:1000};
async function fixture(run){
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;assert.ok(connectionString);
 const schema='monitor_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
 try{
  const store=new PostgresObservationStore({pool,namespace:'app'}),releasesStore=new PostgresReleaseStore({pool,namespace:'app'});await store.initialize();await releasesStore.initialize();
  // Preseed already admitted fixture releases; evaluation gating has its own integration suite.
  for(const id of ['candidate','stable'])await releasesStore.register({manifest:{id},manifestDigest:id==='candidate'?ref.manifestDigest:'b'.repeat(64)},actor.subjectId);
  await releasesStore.setChannel({name:'main',stableId:'stable',canaryId:'candidate',percentage:100,expectedRevision:0},actor.subjectId);
  const evalPolicy={datasetDigest:'fixture',graderRevision:'grader',environmentRevision:'env',repeats:1};
  const releases=new ReleaseManager({store:releasesStore,evaluations:{get:async()=>null},policies:{capability:evalPolicy,regression:evalPolicy},authorize:a=>a.subjectId===actor.subjectId,resolveCohort:a=>a.subjectId});
  const state={complete:true,clock:'2026-01-01T00:00:02.000Z',allowed:true,sourceIds:['task:1']};
  const options={store,releases,sourceScope:'app',authorize:()=>state.allowed,policies:{main:policy},now:()=>new Date(state.clock),discoverSources:async input=>{state.discovery=input;return {sourceIds:state.sourceIds,complete:state.complete};},resolveSource:async sourceId=>({sourceId,sourceScope:'app',confirmed:true,record:{...ref,observedAt:'2026-01-01T00:00:01.000Z',success:false,durationMs:5,toolErrors:0,providerTokens:'3',platformUnits:'9'}})};
  const resolveTarget=async(a,{channel})=>{const current=await releases.channel(a,channel);return {...ref,expectedRevision:current.revision};};
  await run({pool,schema,store,releases,releasesStore,options,state,resolveTarget});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
test('Collection retains partial evidence and pins one window across discovery, restart and assessment',()=>fixture(async({store,options,state})=>{
 state.complete=false;
 const first=await new ReleaseObservation(options).collect(actor,{channel:'main',...ref});assert.equal(first.collectionComplete,false);assert.equal(first.assessment,null);
 state.complete=true;const original=options.resolveSource;options.resolveSource=async id=>{state.clock='2026-01-01T00:00:03.000Z';return original(id);};
 const observation=new ReleaseObservation(options);observation.policy('main').maxErrorRate=1;
 const result=await observation.collect(actor,{channel:'main',...ref});assert.equal(result.assessment.until,'2026-01-01T00:00:02.000Z');assert.equal(state.discovery.until,result.assessment.until);assert.equal(result.assessment.shouldStop,true);assert.equal(result.assessment.metrics.samples,1);assert.equal(result.assessment.metrics.providerTokens,'3');assert.equal(result.assessment.metrics.platformUnits,'9');
 assert.equal((await store.window({...ref,since:state.discovery.since,until:state.discovery.until,limit:10})).records.length,1);
}));
test('Monitor defaults to assessment; explicit host protection atomically stops the candidate and selects fallback',()=>fixture(async({options,state,releasesStore,resolveTarget})=>{
 const monitorOptions={observation:new ReleaseObservation(options),resolveTarget,authorize:()=>true};
 const readout=await new ReleaseMonitor(monitorOptions).run(actor,{channel:'main'});assert.equal(readout.assessment.shouldStop,true);assert.equal(readout.protection,null);assert.equal((await releasesStore.get('candidate')).disabled,false);
 const monitor=new ReleaseMonitor({...monitorOptions,autoProtect:true});const capability=createReleaseMonitorCapability({monitor});assert.equal(capability.retry,'never-replay');assert.deepEqual(Object.keys(capability.input.properties),['channel']);
 const result=await monitor.run(actor,{channel:'main'});assert.equal(result.protection.stableId,'stable');assert.equal((await releasesStore.get('candidate')).disabled,true);
 const historical=await capability.revalidate({channel:'main'},result,{actor});assert.equal(historical.assessment.id,result.assessment.id);assert.equal(historical.protection.revision,2);
 state.allowed=false;await assert.rejects(capability.revalidate({channel:'main'},result,{actor}),{statusCode:403});state.allowed=true;
 await assert.rejects(monitor.run(actor,{channel:'main'}),{statusCode:409});assert.equal((await releasesStore.history()).filter(e=>e.action==='rollback').length,1);
 assert.ok(createObservationCapabilities({observation:monitorOptions.observation,includeCollection:true}).some(c=>c.name==='observation.collect'));
}));
test('Incomplete discovery, revoked protection and concurrent channel change never roll back a candidate',()=>fixture(async({options,state,releasesStore,resolveTarget})=>{
 state.complete=false;const monitor=new ReleaseMonitor({observation:new ReleaseObservation(options),resolveTarget,authorize:()=>true,autoProtect:true});assert.equal((await monitor.run(actor,{channel:'main'})).protection,null);
 state.complete=true;
 const revoked=new ReleaseMonitor({observation:new ReleaseObservation(options),resolveTarget,authorize:(_,input)=>input.action==='monitor',autoProtect:true});await assert.rejects(revoked.run(actor,{channel:'main'}),{statusCode:403});
 const discover=options.discoverSources;options.discoverSources=async input=>{await releasesStore.setChannel({name:'main',stableId:'stable',canaryId:'candidate',percentage:50,expectedRevision:1},actor.subjectId);return discover(input);};
 await assert.rejects(new ReleaseMonitor({observation:new ReleaseObservation(options),resolveTarget,authorize:()=>true,autoProtect:true}).run(actor,{channel:'main'}),{statusCode:409});
 assert.equal((await releasesStore.get('candidate')).disabled,false);assert.equal((await releasesStore.history()).filter(e=>e.action==='rollback').length,0);
}));
test('Collection rejects unavailable, duplicate, excessive, unconfirmed and incorrectly bound discovery',()=>fixture(async({options,state})=>{
 await assert.rejects(new ReleaseObservation({...options,discoverSources:undefined}).collect(actor,{channel:'main',...ref}),{statusCode:503});
 state.sourceIds=['task:1','task:1'];await assert.rejects(new ReleaseObservation(options).collect(actor,{channel:'main',...ref}),{statusCode:409});
 state.sourceIds=['task:1','task:2'];await assert.rejects(new ReleaseObservation({...options,maxSources:1}).collect(actor,{channel:'main',...ref}),{statusCode:409});
 state.sourceIds=['task:1'];await assert.rejects(new ReleaseObservation({...options,resolveSource:()=>null}).collect(actor,{channel:'main',...ref}),{statusCode:409});
 const resolve=options.resolveSource;await assert.rejects(new ReleaseObservation({...options,resolveSource:async id=>{const value=await resolve(id);value.record.releaseId='other';return value;}}).collect(actor,{channel:'main',...ref}),{statusCode:409});
}));

test('Original protection result survives lost acknowledgement, later channel changes and policy aging without another rollback',()=>fixture(async({options,state,releasesStore,resolveTarget,releases})=>{
 const observation=new ReleaseObservation(options),collected=await observation.collect(actor,{channel:'main',...ref});
 const input={assessmentId:collected.assessment.id,expectedRevision:1};
 assert.equal((await observation.protectionResult(actor,input)).status,'unknown');
 const rollback=releases.rollback.bind(releases);let attempts=0;
 releases.rollback=async(...args)=>{attempts++;await rollback(...args);throw Object.assign(new Error('Lost committed rollback acknowledgement'),{outcomeUnknown:true});};
 await assert.rejects(observation.protect(actor,input),/Lost committed/);
 state.clock='2026-01-02T00:00:00.000Z';
 await releasesStore.setChannel({name:'main',stableId:'stable',expectedRevision:2},actor.subjectId);
 const restored=new ReleaseObservation(options),monitor=new ReleaseMonitor({observation:restored,resolveTarget,authorize:()=>true});
 const result=await monitor.recoverProtection(actor,{channel:'main',...input});assert.equal(result.status,'confirmed');assert.equal(result.protection.revision,2);assert.equal((await releases.channel(actor,'main')).revision,3);assert.equal(result.receipt.actor_ref,actor.subjectId);assert.equal(attempts,1);
 const capability=createObservationCapabilities({observation:restored,includeRecovery:true}).find(c=>c.name==='observation.protection_result');assert.equal(capability.effect,'read');assert.equal((await capability.revalidate(input,result,{actor})).status,'confirmed');
 assert.equal((await restored.protectionResult(actor,{...input,expectedRevision:2})).status,'unknown');
 await assert.rejects(monitor.recoverProtection(actor,{channel:'another',...input}),{statusCode:409});
 state.allowed=false;await assert.rejects(capability.revalidate(input,result,{actor}),{statusCode:403});state.allowed=true;
 releases.authorize=()=>false;await assert.rejects(restored.protectionResult(actor,input),{statusCode:403});
 assert.equal((await releasesStore.history()).filter(e=>e.action==='rollback').length,1);
}));

test('Persistent monitor keys bind scope/channel and reconcile unknown pre-protection state without replay',()=>fixture(async({pool,options,resolveTarget,state,releasesStore})=>{
 const store=new PostgresMonitorCycles({pool,namespace:'app'});await store.initialize();
 const monitor=new ReleaseMonitor({observation:new ReleaseObservation(options),resolveTarget,authorize:()=>state.allowed,autoProtect:true});
 const settings={monitor,store,resolveOwner:a=>a.subjectId,authorize:()=>state.allowed};const cycles=new PersistentReleaseMonitor(settings),input={channel:'main',requestKey:'cycle'};
 const result=await cycles.run(actor,input);assert.equal(result.protection.revision,2);assert.deepEqual(await new PersistentReleaseMonitor(settings).run(actor,input),result);
 await assert.rejects(cycles.run(actor,{...input,channel:'other'}),{statusCode:409});await assert.rejects(cycles.recover({subjectId:'other'},input),{statusCode:404});
 await store.begin(actor.subjectId,{channel:'main',requestKey:'unfinished'});await assert.rejects(cycles.run(actor,{channel:'main',requestKey:'unfinished'}),e=>e.outcomeUnknown===true);assert.equal((await releasesStore.history()).filter(e=>e.action==='rollback').length,1);
 state.allowed=false;await assert.rejects(cycles.recover(actor,input),{statusCode:403});assert.equal(createMonitorCycleCapabilities({cycles})[0].retry,'idempotent');
}));

test('Actual worker SIGKILL after rollback recovers by cycle key without caller retaining assessment or repeating protection',()=>fixture(async({pool,schema,options,resolveTarget,releasesStore})=>{
 const store=new PostgresMonitorCycles({pool,namespace:'app'});await store.initialize();
 const code=`import {Pool} from 'pg';import {PostgresMonitorCycles,PersistentReleaseMonitor,ReleaseMonitor,ReleaseObservation,PostgresObservationStore,PostgresReleaseStore,ReleaseManager} from '@immedi/iaic-core';
 const pool=new Pool({connectionString:process.env.SUBMISSION_TEST_DATABASE_URL,options:'-c search_path='+process.env.IAIC_MONITOR_SCHEMA});
 const actor={subjectId:'operator'},store=new PostgresMonitorCycles({pool,namespace:'app'}),rs=new PostgresReleaseStore({pool,namespace:'app'}),p={datasetDigest:'fixture',graderRevision:'grader',environmentRevision:'env',repeats:1};
 const releases=new ReleaseManager({store:rs,evaluations:{get:async()=>null},policies:{capability:p,regression:p},authorize:()=>true,resolveCohort:()=>actor.subjectId});
 const original=releases.rollback.bind(releases);releases.rollback=async(...args)=>{await original(...args);process.send('rollback-committed');await new Promise(()=>{});};
 const ref={releaseId:'candidate',manifestDigest:'a'.repeat(64)};
 const observation=new ReleaseObservation({store:new PostgresObservationStore({pool,namespace:'app'}),releases,sourceScope:'app',authorize:()=>true,now:()=>new Date('2026-01-01T00:00:02.000Z'),policies:{main:{revision:'guard1',fallbackId:'stable',minSamples:1,maxErrorRate:0,maxMeanLatencyMs:1000,windowMs:10000,maxAssessmentAgeMs:1000}},discoverSources:()=>({sourceIds:['task:1'],complete:true}),resolveSource:sourceId=>({sourceId,sourceScope:'app',confirmed:true,record:{...ref,observedAt:'2026-01-01T00:00:01.000Z',success:false,durationMs:5,toolErrors:0,providerTokens:'3',platformUnits:'9'}})});
 const monitor=new ReleaseMonitor({observation,resolveTarget:async()=>({...ref,expectedRevision:(await rs.channel('main')).revision}),authorize:()=>true,autoProtect:true});
 await new PersistentReleaseMonitor({monitor,store,resolveOwner:a=>a.subjectId,authorize:()=>true}).run(actor,{channel:'main',requestKey:'killed-cycle'});`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{cwd:fileURLToPath(new URL('./',import.meta.url)),env:{...process.env,IAIC_MONITOR_SCHEMA:schema},stdio:['ignore','ignore','pipe','ipc']});
 try{const [message]=await once(child,'message',{signal:AbortSignal.timeout(10000)});assert.equal(message,'rollback-committed');const exited=once(child,'exit');child.kill('SIGKILL');assert.equal((await exited)[1],'SIGKILL');}finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
 assert.equal((await store.get(actor.subjectId,'killed-cycle')).state,'prepared');
 options.now=()=>new Date('2026-01-02T00:00:00.000Z');
 let attempted=0;const original=options.releases.rollback.bind(options.releases);options.releases.rollback=(...args)=>{attempted++;return original(...args);};
 const cycles=new PersistentReleaseMonitor({store:new PostgresMonitorCycles({pool,namespace:'app'}),monitor:new ReleaseMonitor({observation:new ReleaseObservation(options),resolveTarget,authorize:()=>true,autoProtect:true}),resolveOwner:a=>a.subjectId,authorize:()=>true});
 const input={channel:'main',requestKey:'killed-cycle'};const result=await cycles.recover(actor,input);assert.equal(result.protection.revision,2);assert.equal((await store.get(actor.subjectId,input.requestKey)).state,'completed');assert.deepEqual(await cycles.run(actor,input),result);assert.equal(attempted,0);assert.equal((await releasesStore.history()).filter(e=>e.action==='rollback').length,1);
}));

test('Assessment-only prepared cycle recovers after completion acknowledgement loss without new collection',()=>fixture(async({pool,options,resolveTarget})=>{
 const store=new PostgresMonitorCycles({pool,namespace:'app'});await store.initialize();let collections=0;
 const monitor=new ReleaseMonitor({observation:new ReleaseObservation(options),resolveTarget:async(...args)=>{collections++;return resolveTarget(...args);},authorize:()=>true});
 const complete=store.complete.bind(store);store.complete=async()=>{throw Error('completion acknowledgement lost');};
 const config={store,monitor,resolveOwner:a=>a.subjectId,authorize:()=>true},input={channel:'main',requestKey:'assessment-only'};
 await assert.rejects(new PersistentReleaseMonitor(config).run(actor,input),e=>e.outcomeUnknown===true);store.complete=complete;
 const result=await new PersistentReleaseMonitor(config).recover(actor,input);assert.equal(result.protection,null);assert.equal(result.assessment.shouldStop,true);assert.equal(collections,1);assert.equal((await store.get(actor.subjectId,input.requestKey)).state,'completed');
}));
