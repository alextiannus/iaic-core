import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {RetentionSweep,MemoryStore,PostgresKnowledgeStore,PostgresIngestedKnowledgeStore,KnowledgeIngestion} from '@immedi/iaic-core';
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL;if(!connectionString)throw Error('Isolated PostgreSQL required');
const schema='retention_example_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
try{
 const scope={applicationId:'example',assistantId:'assistant',subjectId:'owner'},expiresAt='2000-01-01T00:00:00Z';
 const memory=new MemoryStore({pool}),knowledge=new PostgresKnowledgeStore({pool,namespace:'example'}),ingested=new PostgresIngestedKnowledgeStore({pool,namespace:'example'});
 await memory.initialize();await knowledge.initialize();await ingested.initialize();
 await memory.remember(scope,{key:'temporary',kind:'note',content:'temporary private memory',source:{kind:'fixture'},expiresAt});
 await knowledge.put({id:'temporary',title:'Temporary',description:'Fixture',source:{kind:'fixture',reference:'source'},text:'temporary knowledge',expiresAt,expectedRevision:0});
 const ingestion=new KnowledgeIngestion({store:ingested,chunkBytes:4,authorize:async()=>true,resolveSource:async()=>({confirmed:true,sourceId:'temporary',sourceRevision:'v1',mediaType:'text/plain',reference:'fixture',title:'Temporary',description:'Fixture',text:'temporary ingested body',expiresAt})});
 await ingestion.sync({}, {sourceId:'temporary',expectedRevision:0});
 const stores={memory:{expired:o=>memory.expired(scope,o),expire:r=>memory.expire(scope,r)},knowledge,ingested};
 const sweep=new RetentionSweep({resolveStore:async(_a,{sourceId})=>stores[sourceId],authorize:async(a,{sourceId})=>a.subjectId==='owner'&&Object.hasOwn(stores,sourceId)});
 for(const sourceId of Object.keys(stores)){const result=await sweep.run({subjectId:'owner'},{sourceId});assert.equal(result.erased.length,1);assert.equal(result.erased[0].revision,2);assert.equal((await sweep.run({subjectId:'owner'},{sourceId})).erased.length,0);}
 assert.equal((await memory.read(scope,{key:'temporary'})).status,'forgotten');assert.equal((await knowledge.state('temporary')).withdrawn,true);assert.equal((await ingested.sourceState('temporary')).withdrawn,true);assert.deepEqual(await ingested.list(),[]);
 console.log(JSON.stringify({example:'core-retention',status:'passed',stores:3,expiredPayloadErased:true,versionTombstones:true,repeatSafe:true,globalErasure:false,modelInvoked:false}));
}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
