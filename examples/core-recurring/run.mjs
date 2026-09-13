import {Pool} from 'pg';import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';
import {RecurringTaskStore,RecurringTasks,DeferredTaskStore,DeferredTasks} from '@immedi/iaic-core';
const admin=new Pool({connectionString:process.env.DATABASE_URL}),schema='recurring_example_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
try{
 const scope={applicationId:'neutral-example',assistantId:'helper',subjectId:'reader'},store=new RecurringTaskStore({pool}),deferredStore=new DeferredTaskStore({pool});await store.initialize();await deferredStore.initialize();
 const deferred=new DeferredTasks({store:deferredStore,resolveScope:async()=>scope,validateInput:async()=>{},reservedPrefixes:['recurring:']});
 const options={store,resolveScope:async()=>scope,restoreActor:async()=>({id:'reader'}),validateInput:async()=>{},scheduleOccurrence:(actor,input)=>deferred.schedule(actor,input,{internal:true})};
 const recurring=new RecurringTasks(options);const rule=await recurring.create({}, {requestKey:'recurring-example',firstAt:new Date(Date.now()-180000).toISOString(),intervalSeconds:60,occurrenceCount:3,input:{goal:'Prepare a periodic draft'}});
 const result=await recurring.tick();assert.equal(result.state,'completed');assert.equal(result.lastSequence,2);assert.equal(result.skippedCount,2);
 const restored=new RecurringTasks({...options,store:new RecurringTaskStore({pool})});assert.equal((await restored.get({},rule.id)).lastIntentId,result.lastIntentId);assert.equal((await deferred.list({})).items.length,1);assert.equal(await restored.tick(),null);assert.equal((await deferred.get({},result.lastIntentId)).requestKey,`recurring:${rule.id}:2`);
 console.log(JSON.stringify({fixedInterval:true,durableRecovery:true,coalesced:2,occurrences:1,independentOfApplication:true}));
}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
