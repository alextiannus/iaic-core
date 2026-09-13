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
test('shared spacing survives reconstruction and minute boundaries without releasing unknown calls',()=>fixture(async pool=>{
 const config={pool,namespace:'paced',requestsPerMinute:100,tokensPerMinute:100,minimumIntervalMs:60000};
 const rates=new PostgresModelRateLimits(config);await rates.initialize();
 const results=await Promise.allSettled(Array.from({length:8},(_,i)=>new PostgresModelRateLimits(config).admit({taskId:'paced-'+i,turn:1,maximumTokens:1})));
 const admitted=results.filter(r=>r.status==='fulfilled');assert.equal(admitted.length,1);
 for(const r of results.filter(r=>r.status==='rejected')){assert.equal(r.reason.code,'MODEL_RATE_LIMITED');assert.ok(r.reason.retryAfterMs>0&&r.reason.retryAfterMs<=60000);}
 const original=admitted[0].value;
 await pool.query("UPDATE iaic_model_rate_reservations SET window_start=date_trunc('minute',statement_timestamp())-interval '1 minute' WHERE id=$1",[original.id]);
 const rebuilt=new PostgresModelRateLimits(config);await rebuilt.initialize();
 await assert.rejects(rebuilt.admit({taskId:'next',turn:1,maximumTokens:1}),{code:'MODEL_RATE_LIMITED'});
 assert.equal((await rebuilt.get(original.id)).state,'reserved');
 await assert.rejects(new PostgresModelRateLimits({...config,minimumIntervalMs:0}).initialize(),{statusCode:409});
 // Controlled database aging tests the elapsed branch, not real-provider pacing.
 await pool.query("UPDATE iaic_model_rate_reservations SET admitted_at=statement_timestamp()-interval '61 seconds' WHERE id=$1",[original.id]);
 const next=await rebuilt.admit({taskId:'next',turn:1,maximumTokens:1});
 assert.equal((await rebuilt.get(original.id)).state,'reserved');
 await rebuilt.finish(next.id,{notCalled:true,evidence:{kind:'cancelled-before-dispatch'}});
 const after=await rebuilt.admit({taskId:'after-cancel',turn:1,maximumTokens:1});
 await rebuilt.finish(after.id,{actualTokens:1,evidence:{kind:'measured'}});
 await assert.rejects(rebuilt.admit({taskId:'after-success',turn:1,maximumTokens:1}),{code:'MODEL_RATE_LIMITED'});
}));
test('spacing rejection does not call provider or debit platform allowance',()=>fixture(async pool=>{
 const rates=new PostgresModelRateLimits({pool,namespace:'metered-spacing',requestsPerMinute:100,tokensPerMinute:100,minimumIntervalMs:60000});await rates.initialize();
 const ledger=new TokenLedger({pool}),scope={applicationId:'app',subjectId:'user'};await ledger.initialize();await ledger.grant(scope,{reference:'fixture',amount:100,evidence:{fixture:true}});let calls=0;
 const model=meteredModel({model:rateLimitedModel({model:{name:'fixture',next:async()=>{calls++;return {type:'finish',result:{done:true},usage:{inputTokens:1,outputTokens:1}};}},rates,maximumTokens:()=>5}),ledger,scope,policy:{maximum:10,price:{revision:'v1',input:1,cachedInput:1,output:1}}});
 await model.next(request('first'));await assert.rejects(model.next(request('second')),e=>e.code==='MODEL_RATE_LIMITED'&&e.providerNotCalled===true);
 assert.equal(calls,1);assert.equal((await ledger.balance(scope)).available,'98');assert.equal((await ledger.pending(scope)).length,0);
 assert.equal((await pool.query('SELECT count(*) FROM iaic_model_rate_reservations')).rows[0].count,'1');
}));
test('legacy rate tables migrate with zero spacing and preserve original receipts',()=>fixture(async pool=>{
 const config={pool,namespace:'legacy',requestsPerMinute:10,tokensPerMinute:100};const rates=new PostgresModelRateLimits(config);await rates.initialize();
 const original=await rates.admit({taskId:'legacy-task',turn:1,maximumTokens:5});
 await pool.query('ALTER TABLE iaic_model_rate_pools DROP COLUMN minimum_interval_ms');await pool.query('ALTER TABLE iaic_model_rate_reservations DROP COLUMN admitted_at CASCADE');
 const rebuilt=new PostgresModelRateLimits(config);await rebuilt.initialize();const receipt=await rebuilt.get(original.id);
 assert.equal(receipt.state,'reserved');assert.equal(receipt.reserved_tokens,'5');assert.ok(receipt.admitted_at instanceof Date);
 await rebuilt.admit({taskId:'new-task',turn:1,maximumTokens:5});
 await assert.rejects(new PostgresModelRateLimits({...config,minimumIntervalMs:22000}).initialize(),{statusCode:409});
 for(const minimumIntervalMs of [-1,0.1,60001,NaN,'22000'])assert.throws(()=>new PostgresModelRateLimits({...config,minimumIntervalMs}));
}));
test('bounded admission waiting reuses one invocation and never retries an executed provider',async()=>{
 let admissions=0,calls=0,settlements=0;const seen=[];
 const rates={admit:async r=>{seen.push(r);if(++admissions<3)throw Object.assign(Error('local pacing'),{code:'MODEL_RATE_LIMITED',retryAfterMs:2});return {id:'receipt'};},finish:async()=>{settlements++;}};
 const model=rateLimitedModel({rates,maximumTokens:()=>10,admissionWaitMs:100,model:{name:'fixture',next:async()=>{calls++;return {usage:{inputTokens:1,outputTokens:1}};}}});
 await model.next(request('same-turn'));assert.equal(admissions,3);assert.equal(calls,1);assert.equal(settlements,1);assert.ok(seen.every(r=>r.taskId==='same-turn'&&r.turn===1));
 const providerFailure=Object.assign(Error('provider denied without usage'),{providerStatus:429});
 const failed=rateLimitedModel({rates:{admit:async()=>({id:'original'}),finish:async()=>{assert.fail('Unknown provider response must not settle');}},maximumTokens:()=>10,admissionWaitMs:100,model:{name:'fixture',next:async()=>{calls++;throw providerFailure;}}});
 await assert.rejects(failed.next(request('provider-failure')),e=>e===providerFailure&&!e.providerNotCalled&&e.rateReservationId==='original');assert.equal(calls,2);
});
test('admission wait honours cancellation and refuses a delay beyond its budget',async()=>{
 let admissions=0,calls=0;let entered;const ready=new Promise(resolve=>entered=resolve);
 const rates={admit:async()=>{admissions++;entered();throw Object.assign(Error('local pacing'),{code:'MODEL_RATE_LIMITED',providerStatus:429,retryAfterMs:500});},finish:async()=>assert.fail('No admitted receipt')};
 const provider={name:'fixture',next:async()=>{calls++;}};
 const model=rateLimitedModel({rates,model:provider,maximumTokens:()=>10,admissionWaitMs:1000});const controller=new AbortController();
 const result=model.next({...request('cancelled'),signal:controller.signal});await ready;controller.abort();await assert.rejects(result,e=>e.providerNotCalled===true);assert.equal(admissions,1);assert.equal(calls,0);
 const limited=rateLimitedModel({rates,model:provider,maximumTokens:()=>10,admissionWaitMs:10});await assert.rejects(limited.next(request('bounded')),e=>e.code==='MODEL_RATE_LIMITED'&&e.providerNotCalled===true);assert.equal(admissions,2);assert.equal(calls,0);
 for(const admissionWaitMs of [-1,60001,0.1,'20'])assert.throws(()=>rateLimitedModel({rates,model:provider,maximumTokens:()=>10,admissionWaitMs}));
});
