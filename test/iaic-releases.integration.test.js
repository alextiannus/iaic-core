import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {EvaluationRunner} from '@immedi/iaic-core';
import {ReleaseManager} from '@immedi/iaic-core/releases/service.js';
import {PostgresReleaseStore} from '@immedi/iaic-core/releases/store.js';
async function fixture(run){const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;assert.ok(connectionString);const schema='releases_test_'+randomUUID().replaceAll('-','');const admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});try{await run(pool);}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}}
const actor={subjectId:'maintainer'};
const definition=revision=>({id:revision,implementationRevision:revision,versions:Object.fromEntries(['prompt','model','skills','tools','knowledge','harness'].map(name=>[name,name+'-v1']))});
async function environment(pool){
 const records=new Map();const dataset=[{id:'goal',category:'outcome',input:1,expected:1}];
 const runner=new EvaluationRunner({execute:({input,revision})=>({result:revision==='bad'?0:input}),grade:({testCase,observation})=>({passed:testCase.expected===observation.result,score:testCase.expected===observation.result?1:0,checks:[{name:'outcome',passed:testCase.expected===observation.result}]})});
 for(const revision of ['v1','v2','bad']){const run=await runner.run({dataset,revision,graderRevision:'grader1',environmentRevision:'env1'});records.set(revision,run);}
 const first=records.get('v1'),policy={datasetDigest:first.datasetDigest,graderRevision:'grader1',environmentRevision:'env1',repeats:1,thresholds:{requiredChecks:['outcome']}};
 const store=new PostgresReleaseStore({pool,namespace:'app'});await store.initialize();
 const manager=new ReleaseManager({store,evaluations:{get:async id=>structuredClone(records.get(id))},policies:{capability:policy,regression:{...policy,baselineId:'v1'}},authorize:current=>current.subjectId==='maintainer',resolveCohort:current=>current.subjectId});
 return {manager,store,records};
}
test('Release registration binds immutable manifests to frozen passing evidence',async()=>fixture(async pool=>{
 const {manager,store,records}=await environment(pool);
 const request={manifest:definition('v1'),evaluations:{capability:'v1',regression:'v1'}};
 const registered=await manager.register(actor,request);assert.equal((await manager.register(actor,request)).digest,registered.digest);
 await assert.rejects(manager.register(actor,{...request,manifest:{...definition('v1'),versions:{...definition('v1').versions,prompt:'changed'}}}),{statusCode:409});
 await assert.rejects(manager.register(actor,{manifest:definition('bad'),evaluations:{capability:'bad',regression:'bad'}}),{statusCode:409});
 records.get('v2').graderRevision='weaker-grader';
 await assert.rejects(manager.register(actor,{manifest:definition('v2'),evaluations:{capability:'v2',regression:'v2'}}),{statusCode:409});
 assert.equal(await store.get('bad'),null);
 assert.equal(await new PostgresReleaseStore({pool,namespace:'other'}).get('v1'),null);
}));
test('Canary, stop and rollback preserve pinned release bindings and survive store reconstruction',async()=>fixture(async pool=>{
 const {manager,store}=await environment(pool);
 for(const revision of ['v1','v2'])await manager.register(actor,{manifest:definition(revision),evaluations:{capability:revision,regression:revision}});
 await manager.setChannel(actor,{name:'main',stableId:'v1',expectedRevision:0});
 const stable=await manager.resolve(actor,'main');assert.equal(stable.releaseId,'v1');
 await manager.setChannel(actor,{name:'main',stableId:'v1',canaryId:'v2',percentage:100,expectedRevision:1});
 const canary=await manager.resolve(actor,'main');assert.equal(canary.releaseId,'v2');
 assert.deepEqual(await manager.resolve(actor,'main'),canary);
 assert.equal((await manager.check(actor,stable)).id,'v1');
 await manager.stop(actor,'v2');
 await assert.rejects(manager.check(actor,canary),{statusCode:409});
 assert.equal((await manager.resolve(actor,'main')).releaseId,'v1');
 await manager.setChannel(actor,{name:'main',stableId:'v1',expectedRevision:2});
 assert.equal((await new PostgresReleaseStore({pool,namespace:'app'}).channel('main')).revision,3);
 assert.equal((await store.get('v2')).disabled,true);
 assert.ok((await manager.history(actor)).some(event=>event.action==='stop'&&event.actor_ref==='maintainer'));
 await assert.rejects(manager.setChannel(actor,{name:'main',stableId:'v2',expectedRevision:3}),{statusCode:409});
}));
test('Concurrent channel changes cannot overwrite an unobserved release decision',async()=>fixture(async pool=>{
 const {manager,store}=await environment(pool);
 await manager.register(actor,{manifest:definition('v1'),evaluations:{capability:'v1',regression:'v1'}});
 const result=await Promise.allSettled([manager.setChannel(actor,{name:'main',stableId:'v1',expectedRevision:0}),manager.setChannel(actor,{name:'main',stableId:'v1',expectedRevision:0})]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal((await store.channel('main')).revision,1);
 await assert.rejects(manager.stop({subjectId:'other'},'v1'),{statusCode:403});assert.equal((await store.get('v1')).disabled,false);
}));
