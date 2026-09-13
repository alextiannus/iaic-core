import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Pool} from 'pg';
import {EvaluationRunner,FileEvaluationStore,ReleaseManager,PostgresReleaseStore,createReleaseCapabilities,CapabilityDispatcher,FileObjectStore,ObjectStorage,ReleaseResources} from '@immedi/iaic-core';
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL URL required');
const schema='releases_example_'+randomUUID().replaceAll('-',''),directory=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-release-example-'));
const admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
try{
 const evaluations=new FileEvaluationStore({directory}),runs=[];
 const runner=new EvaluationRunner({execute:({input})=>({result:input}),grade:({observation,testCase})=>({passed:observation.result===testCase.expected,score:1,checks:[{name:'outcome',passed:observation.result===testCase.expected}]})});
 for(const revision of ['fixture-v1','fixture-v2']){const run=await runner.run({dataset:[{id:'case',category:'core-example',input:'verified',expected:'verified'}],revision,graderRevision:'grader1',environmentRevision:'fixture1'});await evaluations.put(run);runs.push(run);}
 const p={datasetDigest:runs[0].datasetDigest,graderRevision:'grader1',environmentRevision:'fixture1',repeats:1,thresholds:{requiredChecks:['outcome']}};
 const store=new PostgresReleaseStore({pool,namespace:'example'});await store.initialize();
 const manager=new ReleaseManager({store,evaluations,policies:{capability:p,regression:{...p,baselineId:runs[0].id}},authorize:a=>a.subjectId==='platform',resolveCohort:a=>a.subjectId}),actor={subjectId:'platform'};
 const objects=new ObjectStorage({store:new FileObjectStore({directory:path.join(directory,'objects')}),resolveScope:a=>a.subjectId,authorize:a=>a.subjectId==='platform'});
 for(const run of runs){const ref=await objects.put(actor,Buffer.from('Prompt '+run.revision));await manager.register(actor,{manifest:{id:run.revision,implementationRevision:run.revision,resources:[{path:'prompts/main.txt',...ref,reference:ref}],versions:{prompt:ref.sha256,model:'fixture1',skills:'none1',tools:'fixture1',knowledge:'none1',harness:'fixture1'}},evaluations:{capability:run.id,regression:run.id}});}
 await manager.setChannel(actor,{name:'production',stableId:'fixture-v1',expectedRevision:0});
 await manager.setChannel(actor,{name:'production',stableId:'fixture-v1',canaryId:'fixture-v2',percentage:100,expectedRevision:1});
 const dispatcher=new CapabilityDispatcher({capabilities:createReleaseCapabilities({releases:manager})});
 const selected=await dispatcher.invoke('releases.resolve',{name:'production'},{actor});assert.equal(selected.releaseId,'fixture-v2');
 const resources=new ReleaseResources({releases:manager,readResource:(a,ref)=>objects.get(a,ref)});
 const loaded=await resources.materialize(actor,selected,{parentDirectory:directory});assert.equal(await fs.readFile(path.join(loaded.directory,'prompts/main.txt'),'utf8'),'Prompt fixture-v2');
 await manager.stop(actor,'fixture-v2');await assert.rejects(manager.check(actor,selected),{statusCode:409});
 await manager.setChannel(actor,{name:'production',stableId:'fixture-v1',expectedRevision:2});
 assert.equal((await manager.resolve(actor,'production')).releaseId,'fixture-v1');
 console.log(JSON.stringify({example:'core-releases',status:'passed',boundEvaluationEvidence:true,canaryStopped:true,rollbackSelection:true,materializedResources:true,productionDeployed:false}));
}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await fs.rm(directory,{recursive:true,force:true});}
