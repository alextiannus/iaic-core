import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {PostgresObservationStore,PostgresReleaseStore,ReleaseManager,ReleaseObservation,ReleaseMonitor,createReleaseMonitorCapability,createObservationCapabilities} from '@immedi/iaic-core';
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
  await run({store,releases,releasesStore,options,state,resolveTarget});
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
test('Monitor defaults to assessment; explicit host protection atomically stops the candidate and selects fallback',()=>fixture(async({options,releasesStore,resolveTarget})=>{
 const monitorOptions={observation:new ReleaseObservation(options),resolveTarget,authorize:()=>true};
 const readout=await new ReleaseMonitor(monitorOptions).run(actor,{channel:'main'});assert.equal(readout.assessment.shouldStop,true);assert.equal(readout.protection,null);assert.equal((await releasesStore.get('candidate')).disabled,false);
 const monitor=new ReleaseMonitor({...monitorOptions,autoProtect:true});const capability=createReleaseMonitorCapability({monitor});assert.equal(capability.retry,'never-replay');assert.deepEqual(Object.keys(capability.input.properties),['channel']);
 const result=await monitor.run(actor,{channel:'main'});assert.equal(result.protection.stableId,'stable');assert.equal((await releasesStore.get('candidate')).disabled,true);
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
