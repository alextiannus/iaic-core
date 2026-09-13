import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {MemoryStore,AssistantMemory} from '@immedi/iaic-core';
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');
const schema='assessment_example_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
try{
 const store=new MemoryStore({pool});await store.initialize();const actor={subjectId:'reader'},reviewer={subjectId:'reader',role:'reviewer'};
 const config={store,resolveScope:a=>({applicationId:'example',assistantId:'helper',subjectId:a.subjectId}),sourceFor:()=>({kind:'user-statement'}),authorizeAssessment:a=>a.role==='reviewer',assessmentSourceFor:()=>({kind:'fixture-review',reference:'fixture-reviewer/v1'})};
 const memory=new AssistantMemory(config);await memory.remember(actor,{key:'preference',kind:'note',content:'A fixture user claim'});
 const judgment={key:'preference',expectedRevision:1,level:'contradicted',reason:'The fixture reference conflicts with this claim',evidence:[{kind:'fixture',reference:'source/v1'}]};
 await assert.rejects(memory.assess(actor,judgment),{statusCode:403});await memory.assess(reviewer,judgment);
 assert.equal((await new AssistantMemory(config).read(actor,{key:'preference'})).assessment.assessor.reference,'fixture-reviewer/v1');assert.deepEqual(await memory.list(actor),[]);assert.equal((await memory.list(actor,{status:'contradicted'})).length,1);
 assert.equal((await memory.export(actor)).memories.length,0);await memory.remember(actor,{key:'preference',kind:'note',content:'An explicitly corrected user claim',expectedRevision:2});assert.equal((await memory.read(actor,{key:'preference'})).assessment,null);
 await memory.forget(actor,{key:'preference',expectedRevision:3});const record=(await pool.query('SELECT content,source,assessment FROM iaic_memories')).rows[0];assert.deepEqual(record,{content:null,source:null,assessment:null});
 console.log(JSON.stringify({example:'core-memory-assessment',status:'passed',reviewerPolicy:true,revisionBound:true,contradictedExcluded:true,correctionClearsAssessment:true,forgottenMetadataErased:true}));
}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
