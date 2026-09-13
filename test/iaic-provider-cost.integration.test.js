import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {TokenLedger,ProviderCostAccounting,meteredModel} from '@immedi/iaic-core';
const basis=(extra={})=>({format:'iaic.provider-cost.v1',revision:'fixture-v1',currency:'USD',minorUnitScale:2,bearer:'platform',accountReference:'fixture-account',model:'fixture',inputPerMillionMinor:'300',cachedInputPerMillionMinor:'30',outputPerMillionMinor:'1200',missingCachedInput:'incomplete',...extra});
const policy=costBasis=>({maximum:'500',price:{revision:'allowance-v1',input:'2',cachedInput:'1',output:'3'},costBasis});
const request=(taskId='task',turn=1)=>({billingContext:{taskId,turn}});
const model=(usage={inputTokens:100,cachedInputTokens:20,outputTokens:50,reasoningOutputTokens:10})=>({name:'fixture',next:async()=>({result:'fixture',usage})});
async function fixture(fn){
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');const schema='provider_cost_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
 try{const scope={applicationId:'fixture',subjectId:'user'},ledger=new TokenLedger({pool});await ledger.initialize();await ledger.grant(scope,{reference:'fixture',amount:'10000',evidence:{fixture:true}});await fn({pool,scope,ledger,costs:new ProviderCostAccounting({ledger})});}
 finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
test('Provider currency estimates retain fractional minor units and stay separate from platform allowance',async()=>fixture(async f=>{
 const prices=basis(),gateway=meteredModel({model:model(),ledger:f.ledger,scope:f.scope,policy:policy(prices)});
 const first=await gateway.next(request());await gateway.next(request('task',2));prices.outputPerMillionMinor='999999';
 const cost=await new ProviderCostAccounting({ledger:new TokenLedger({pool:f.pool})}).task(f.scope,'task');assert.equal(cost.complete,true);assert.equal(cost.totals[0].minorUnitsNumerator,'169200000000');assert.equal(cost.totals[0].minorUnitsCeiling,'1');assert.equal(cost.receipts[0].priceRevision,'fixture-v1');
 assert.equal((await f.ledger.taskUsage(f.scope,'task')).providerTokens,'300');assert.equal((await f.ledger.taskUsage(f.scope,'task')).platformUnits,'660');assert.equal((await f.ledger.balance(f.scope)).balance,'9340');
 const row=await f.ledger.call(f.pool,[f.scope.applicationId,f.scope.subjectId],first.billing.requestId);
 await assert.rejects(f.ledger.reserve(f.scope,{requestId:row.request_id,mode:row.mode,maximum:row.reserved,price:row.price,attribution:row.attribution,costBasis:basis({revision:'different'})}),{statusCode:409});
 assert.equal((await f.costs.task({...f.scope,subjectId:'other'},'task')).requests,0);
}));
test('BYOK can have user-borne provider cost while platform charge remains zero; missing cache evidence stays incomplete',async()=>fixture(async f=>{
 const gateway=meteredModel({model:model(),ledger:f.ledger,scope:f.scope,mode:'BYOK',policy:policy(basis({bearer:'user'}))});await gateway.next(request('byok'));
 const cost=await f.costs.task(f.scope,'byok');assert.equal(cost.complete,true);assert.equal(cost.totals[0].bearer,'user');assert.equal(cost.totals[0].minorUnitsNumerator,'84600000000');assert.equal((await f.ledger.taskUsage(f.scope,'byok')).platformUnits,'0');
 await meteredModel({model:model({inputTokens:10,outputTokens:5}),ledger:f.ledger,scope:f.scope,policy:policy(basis())}).next(request('missing-cache'));
 const missing=await f.costs.task(f.scope,'missing-cache');assert.equal(missing.complete,false);assert.equal(missing.incompleteUsage,1);assert.deepEqual(missing.totals,[]);
 assert.throws(()=>meteredModel({model:model(),ledger:f.ledger,scope:f.scope,policy:policy(basis({model:'another-model'}))}),/compatible/);
 assert.throws(()=>meteredModel({model:model(),ledger:f.ledger,scope:f.scope,mode:'BYOK',policy:policy(basis())}),/compatible/);
}));
test('Unknown usage is rated only after source reconciliation using the original currency basis',async()=>fixture(async f=>{
 const gateway=meteredModel({model:model(null),ledger:f.ledger,scope:f.scope,policy:policy(basis())});await assert.rejects(gateway.next(request()),{code:'USAGE_RECONCILIATION_REQUIRED'});
 const before=await f.costs.task(f.scope,'task');assert.equal(before.complete,false);assert.equal(before.pending,1);assert.deepEqual(before.totals,[]);
 const pending=(await f.ledger.pending(f.scope))[0];await f.ledger.reconcile(f.scope,{sourceId:'confirmed-provider-usage',requestId:pending.request_id,outcome:'measured',providerReference:'fixture-provider-receipt',usage:{input_tokens:100,input_tokens_details:{cached_tokens:20},output_tokens:50},evidence:{fixture:true}});
 const after=await f.costs.task(f.scope,'task');assert.equal(after.complete,true);assert.equal(after.totals[0].minorUnitsNumerator,'84600000000');assert.equal(after.receipts[0].priceRevision,'fixture-v1');
}));
test('Unpriced calls are not zero cost and different currencies are never silently converted',async()=>fixture(async f=>{
 await meteredModel({model:model(),ledger:f.ledger,scope:f.scope,policy:policy(undefined)}).next(request('legacy'));const legacy=await f.costs.task(f.scope,'legacy');assert.equal(legacy.complete,false);assert.equal(legacy.unpriced,1);
 for(const b of [basis(),basis({currency:'JPY',minorUnitScale:0,revision:'fixture-yen'})])await meteredModel({model:model(),ledger:f.ledger,scope:f.scope,policy:policy(b)}).next(request('mixed'));
 const mixed=await f.costs.task(f.scope,'mixed');assert.equal(mixed.complete,true);assert.equal(mixed.totals.length,2);assert.deepEqual(mixed.totals.map(v=>v.currency),['JPY','USD']);
}));

test('Sub-minor-unit provider prices are represented exactly rather than rounded at admission',async()=>fixture(async f=>{
 const gateway=meteredModel({model:model({inputTokens:1,cachedInputTokens:0,outputTokens:0}),ledger:f.ledger,scope:f.scope,policy:policy(basis({inputPerMillionMinor:'0.125000',cachedInputPerMillionMinor:'0.010000',outputPerMillionMinor:'0.75'}))});
 await gateway.next(request());const cost=await f.costs.task(f.scope,'task');assert.equal(cost.totals[0].minorUnitsNumerator,'125000');assert.equal(cost.totals[0].denominator,'1000000000000');assert.equal(cost.totals[0].minorUnitsCeiling,'1');
 const rows=await f.ledger.costCalls(f.scope,'task');assert.equal(rows[0].costBasis.inputPerMillionMinor,'0.125');
}));
