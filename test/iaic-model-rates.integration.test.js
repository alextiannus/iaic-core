import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {PostgresModelRateLimits,rateLimitedModel,PostgresModelCapacity,capacityModel,TokenLedger,meteredModel} from '@immedi/iaic-core';
async function fixture(run){const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;assert.ok(connectionString);const schema='rates_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});try{await run(pool);}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}}
const request=taskId=>({billingContext:{taskId,turn:1}});
test('database admission serializes shared Token reservations and rejects changed pool configuration',()=>fixture(async pool=>{
 const config={pool,namespace:'shared',requestsPerMinute:100,tokensPerMinute:10},rates=new PostgresModelRateLimits(config);await rates.initialize();
 const results=await Promise.allSettled(Array.from({length:12},(_,i)=>new PostgresModelRateLimits(config).admit({taskId:'t'+i,turn:1,maximumTokens:6})));
 const accepted=results.filter(r=>r.status==='fulfilled').map(r=>r.value);const windows=new Map();for(const r of accepted){const k=r.window_start.toISOString();windows.set(k,(windows.get(k)||0)+Number(r.reserved_tokens));}for(const sum of windows.values())assert.ok(sum<=10);
 assert.ok(results.some(r=>r.status==='rejected'&&r.reason.code==='MODEL_RATE_LIMITED'&&r.reason.retryAfterMs>0&&r.reason.retryAfterMs<=60000));
 await assert.rejects(new PostgresModelRateLimits({...config,tokensPerMinute:11}).initialize(),{statusCode:409});
 const original=accepted[0];await rates.finish(original.id,{notCalled:true,evidence:{fixture:true}});await assert.rejects(rates.admit({taskId:original.task_id,turn:1,maximumTokens:1}),{code:'MODEL_TURN_ALREADY_ADMITTED'});
}));
test('confirmed usage replaces Token reservation, RPM still counts, and terminal receipt cannot be rewritten',()=>fixture(async pool=>{
 const rates=new PostgresModelRateLimits({pool,namespace:'rpm',requestsPerMinute:1,tokensPerMinute:100});await rates.initialize();
 const r=await rates.admit({taskId:'a',turn:1,maximumTokens:90});await rates.finish(r.id,{actualTokens:2,evidence:{kind:'original'}});
 await pool.query("UPDATE iaic_model_rate_reservations SET window_start=date_trunc('minute',statement_timestamp()) WHERE id=$1",[r.id]);
 await assert.rejects(rates.admit({taskId:'b',turn:1,maximumTokens:1}),{code:'MODEL_RATE_LIMITED'});
 assert.equal((await rates.finish(r.id,{actualTokens:2,evidence:{kind:'replacement'}})).evidence.kind,'original');await assert.rejects(rates.finish(r.id,{notCalled:true,evidence:{fixture:true}}),{statusCode:409});
 await pool.query("UPDATE iaic_model_rate_reservations SET window_start=date_trunc('minute',statement_timestamp())-interval '1 minute' WHERE id=$1",[r.id]);
 assert.equal((await rates.admit({taskId:'b',turn:1,maximumTokens:1})).state,'reserved');
 await assert.rejects(rates.admit({taskId:'a',turn:1,maximumTokens:1}),{code:'MODEL_TURN_ALREADY_ADMITTED'});
}));
test('unknown and over-bound usage remain conservative and cannot become zero-cost preflight',()=>fixture(async pool=>{
 const config={pool,namespace:'tokens',requestsPerMinute:100,tokensPerMinute:10},rates=new PostgresModelRateLimits(config);await rates.initialize();
 let id;const model=rateLimitedModel({rates,maximumTokens:()=>10,model:{name:'fixture',next:async()=>{throw Error('response lost');}}});
 await assert.rejects(model.next(request('unknown')),e=>{id=e.rateReservationId;return e.message==='response lost'&&!e.rateSettlementConfirmed;});
 assert.equal((await new PostgresModelRateLimits(config).get(id)).state,'reserved');
 await rates.finish(id,{actualTokens:15,evidence:{kind:'late-confirmed-usage'}});assert.equal((await rates.get(id)).actual_tokens,'15');
 await pool.query("UPDATE iaic_model_rate_reservations SET window_start=date_trunc('minute',statement_timestamp()) WHERE id=$1",[id]);
 await assert.rejects(rates.admit({taskId:'later',turn:1,maximumTokens:1}),{code:'MODEL_RATE_LIMITED'});
}));
test('rate/capacity/metering compose without platform debit on rejected admission',()=>fixture(async pool=>{
 const rates=new PostgresModelRateLimits({pool,namespace:'provider',requestsPerMinute:10,tokensPerMinute:10});await rates.initialize();const capacity=new PostgresModelCapacity({pool,namespace:'provider',maxConcurrent:1});await capacity.initialize();
 const ledger=new TokenLedger({pool}),scope={applicationId:'app',subjectId:'user'};await ledger.initialize();await ledger.grant(scope,{reference:'fixture',amount:100,evidence:{fixture:true}});let calls=0;
 const provider={name:'fixture',next:async()=>{calls++;return {type:'finish',result:{done:true},usage:{inputTokens:2,outputTokens:1}};}};
 const model=meteredModel({model:rateLimitedModel({model:capacityModel({model:provider,capacity}),rates,maximumTokens:()=>10}),ledger,scope,policy:{maximum:10,price:{revision:'v1',input:1,cachedInput:1,output:1}}});
 const occupied=await capacity.admit({taskId:'occupied',turn:1});await assert.rejects(model.next(request('capacity-busy')),{code:'MODEL_CAPACITY_BUSY'});assert.equal(calls,0);assert.equal((await ledger.balance(scope)).available,'100');
 await capacity.release(occupied.id,{fixture:true});const result=await model.next(request('success'));assert.equal(result.rate.settlementConfirmed,true);assert.equal(calls,1);assert.equal((await ledger.balance(scope)).available,'97');
 await pool.query("UPDATE iaic_model_rate_reservations SET window_start=date_trunc('minute',statement_timestamp()) WHERE state='settled'");
 await assert.rejects(model.next(request('rate-busy')),{code:'MODEL_RATE_LIMITED'});assert.equal(calls,1);assert.equal((await ledger.balance(scope)).available,'97');assert.equal((await ledger.pending(scope)).length,0);
}));
test('rate settlement acknowledgement loss preserves actual result and usage',async()=>{
 let called=0;const model=rateLimitedModel({model:{name:'fixture',next:async()=>{called++;return {type:'finish',result:{done:true},usage:{inputTokens:2,outputTokens:1}};}},rates:{admit:async()=>({id:'fixture'}),finish:async()=>{throw Error('lost commit acknowledgement');}},maximumTokens:()=>10});
 const result=await model.next(request('one'));assert.equal(result.result.done,true);assert.equal(result.usage.inputTokens,2);assert.equal(result.rate.settlementConfirmed,false);assert.equal(called,1);
});
