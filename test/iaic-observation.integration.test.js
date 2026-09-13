import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';import {PostgresObservationStore,ReleaseObservation} from '@immedi/iaic-core';
async function fixture(run){const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');const schema='observe_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});try{const store=new PostgresObservationStore({pool,namespace:'fixture'});await store.initialize();await run(store);}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}}
const ref={releaseId:'candidate',manifestDigest:'a'.repeat(64)};
const record={...ref,observedAt:'2026-01-01T00:00:00.000Z',success:false,durationMs:100,toolErrors:1,providerTokens:'5',platformUnits:'7',cost:{currency:'USD',minorUnits:'60'}};
const policy={revision:'policy1',fallbackId:'stable',minSamples:2,maxErrorRate:0,maxMeanLatencyMs:1000,maxCostMinor:'100',currency:'USD',windowMs:10000,maxAssessmentAgeMs:1000};
test('Observation sources are immutable and incomplete samples cannot trigger rollback',async()=>fixture(async store=>{
 let clock=new Date('2026-01-01T00:00:02Z'),stops=0;const policies={main:{...policy}};const o=new ReleaseObservation({store,releases:{check:async()=>{},rollback:async()=>{stops++;return {}; }},sourceScope:'app',authorize:()=>true,policies,now:()=>clock,resolveSource:sourceId=>({sourceId,sourceScope:'app',confirmed:true,record})});
 policies.main.maxErrorRate=1;
 await o.record({}, {sourceId:'first'});await o.record({}, {sourceId:'first'});const incomplete=await o.assess({}, {channel:'main',...ref});assert.equal(incomplete.metrics.samples,1);assert.equal(incomplete.complete,false);await assert.rejects(o.protect({}, {assessmentId:incomplete.id,expectedRevision:1}),{statusCode:409});
 await assert.rejects(store.record({...record,sourceId:'first',success:true}),{statusCode:409});
 await o.record({}, {sourceId:'second'});const full=await o.assess({}, {channel:'main',...ref});assert.deepEqual(full.violations,['error-rate','monetary-cost']);assert.equal(full.metrics.providerTokens,'10');assert.equal(full.metrics.platformUnits,'14');assert.equal(full.metrics.cost.minorUnits,'120');assert.equal(full.shouldStop,true);
 clock=new Date('2026-01-01T00:00:04Z');await assert.rejects(o.protect({}, {assessmentId:full.id,expectedRevision:1}),{statusCode:409});assert.equal(stops,0);
}));
test('Observation cost gates require complete comparable currency evidence',async()=>fixture(async store=>{
 await store.record({...record,sourceId:'one'});await store.record({...record,sourceId:'two',cost:{currency:'EUR',minorUnits:'60'}});
 const o=new ReleaseObservation({store,releases:{check:async()=>{}},sourceScope:'app',authorize:()=>true,policies:{main:policy},now:()=>new Date('2026-01-01T00:00:02Z'),resolveSource:()=>null});
 const result=await o.assess({}, {channel:'main',...ref});assert.equal(result.complete,false);assert.equal(result.metrics.cost,null);assert.equal(result.shouldStop,false);
 await assert.rejects(o.record({}, {sourceId:'unconfirmed'}),{statusCode:409});
}));
test('Task usage reads distinguish provider tokens from platform allowance and preserve unknown holds',async()=>fixture(async store=>{
 const {TokenLedger}=await import('@immedi/iaic-core');const ledger=new TokenLedger({pool:store.pool});await ledger.initialize();const scope={applicationId:'app',subjectId:'owner'};
 await ledger.grant(scope,{reference:'grant',amount:100,evidence:{fixture:true}});
 await ledger.reserve(scope,{requestId:'call',mode:'SYSTEM_MANAGED',maximum:50,price:{revision:'price1',input:2,cachedInput:1,output:3},attribution:{taskId:'task'}});
 assert.equal((await ledger.taskUsage(scope,'task')).complete,false);
 await ledger.settle(scope,{requestId:'call',usage:{input_tokens:2,output_tokens:1},providerReference:'fixture-ref',failed:false});
 assert.deepEqual(await ledger.taskUsage(scope,'task'),{requests:'1',pending:'0',providerTokens:'3',platformUnits:'7',complete:true});
 assert.equal((await ledger.taskUsage({...scope,subjectId:'other'},'task')).requests,'0');
}));
