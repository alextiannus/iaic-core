import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {TokenLedger,AllowanceBudgets} from '@immedi/iaic-core';
async function fixture(fn){const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');const schema='budget_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});try{
 const ledger=new TokenLedger({pool});await ledger.initialize();const budgets=new AllowanceBudgets({ledger});ledger.budgets=budgets;await budgets.initialize();
 const scope={applicationId:'app',subjectId:'payer'};await ledger.grant(scope,{reference:'fixture',amount:1000,evidence:{fixture:true}});
 await budgets.create(scope,{id:'shared',maximum:'100',executors:['alice','bob'],deadlineAt:new Date(Date.now()+60000).toISOString(),overflow:'platform_absorbs'});
 const reserve=(id,executor,maximum='60')=>ledger.reserve(scope,{requestId:id,mode:'SYSTEM_MANAGED',maximum,price:{revision:'fixture',input:'1',cachedInput:'1',output:'1'},attribution:{taskId:id,executor},budget:{id:'shared',executor}});
 await fn({ledger,budgets,scope,reserve,pool});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}}
test('Shared allowance budget atomically bounds multiple executors without minting credits',async()=>fixture(async({ledger,budgets,scope,reserve})=>{
 const admissions=await Promise.allSettled([reserve('a','alice'),reserve('b','bob')]);assert.equal(admissions.filter(r=>r.status==='fulfilled').length,1);
 const id=admissions[0].status==='fulfilled'?'a':'b';assert.equal((await budgets.read(scope,'shared')).held,'60');
 const settled=await ledger.settle(scope,{requestId:id,usage:{input_tokens:80,output_tokens:40},providerReference:'provider-1'});
 assert.equal(settled.receipt.delta,'-60');assert.equal(settled.receipt.evidence.ratedCredits,'120');assert.equal(settled.receipt.evidence.platformAbsorbedUnits,'60');assert.equal(settled.receipt.evidence.usage.input_tokens,80);
 await reserve('next','bob','40');await assert.rejects(reserve('over','alice','1'),{code:'ALLOWANCE_BUDGET_EXHAUSTED'});
 const budget=await budgets.read(scope,'shared');assert.equal(budget.available,'0');assert.equal(budget.spent,'60');assert.equal(budget.held,'40');assert.equal((await ledger.balance(scope)).balance,'940');
}));
test('Unknown usage stays held across reconstruction and revoked budgets still settle prior usage',async()=>fixture(async({ledger,budgets,scope,reserve,pool})=>{
 await reserve('one','alice','100');await ledger.markUnknown(scope,{requestId:'one',evidence:{reason:'lost_response'}});
 const restored=new TokenLedger({pool}),b=new AllowanceBudgets({ledger:restored});restored.budgets=b;
 assert.equal((await b.read(scope,'shared')).held,'100');await assert.rejects(reserve('two','bob','1'),{code:'ALLOWANCE_BUDGET_EXHAUSTED'});
 await b.revoke(scope,'shared');await assert.rejects(reserve('three','bob','1'),{statusCode:403});
 await restored.reconcile(scope,{sourceId:'receipt',requestId:'one',outcome:'measured',providerReference:'provider',usage:{input_tokens:10,output_tokens:5},failed:false,evidence:{confirmed:true}});
 assert.equal((await b.read(scope,'shared')).spent,'15');assert.equal((await b.read(scope,'shared')).held,'0');assert.equal((await b.read(scope,'shared')).revoked,true);
}));
test('Budget requires explicit overflow policy, approved executors and immutable account binding',async()=>fixture(async({ledger,budgets,scope,reserve})=>{
 await assert.rejects(reserve('intruder','mallory'),{statusCode:403});
 await assert.rejects(budgets.read({...scope,subjectId:'other'},'shared'),{statusCode:404});
 await assert.rejects(budgets.create(scope,{id:'bad',maximum:'10',executors:['alice'],deadlineAt:new Date(Date.now()+60000).toISOString()}),/platform_absorbs/);
 await reserve('bound','alice');await assert.rejects(reserve('bound','bob'),{statusCode:409});
 const noBudget=new TokenLedger({pool:ledger.pool});await assert.rejects(noBudget.reserve(scope,{requestId:'missing',mode:'SYSTEM_MANAGED',maximum:'1',price:{revision:'r',input:'1',cachedInput:'1',output:'1'},attribution:{taskId:'missing'},budget:{id:'shared',executor:'alice'}}),{statusCode:503});
}));
test('Existing model gateway applies the shared budget and BYOK retains zero platform charges',async()=>fixture(async({ledger,budgets,scope})=>{
 const {meteredModel}=await import('@immedi/iaic-core');let calls=0;
 const provider={name:'fixture',next:async()=>{calls++;return {usage:{inputTokens:80,outputTokens:40}};}};
 const policy={maximum:'100',price:{revision:'p',input:'1',cachedInput:'1',output:'1'},budget:{id:'shared',executor:'bob'}};
 const model=meteredModel({model:provider,ledger,scope,policy});await model.next({billingContext:{taskId:'shared-task',turn:1}});
 await assert.rejects(model.next({billingContext:{taskId:'shared-task',turn:2}}),{code:'ALLOWANCE_BUDGET_EXHAUSTED'});assert.equal(calls,1);
 const own=meteredModel({model:provider,ledger,scope,policy,mode:'BYOK'});const result=await own.next({billingContext:{taskId:'own-task',turn:1}});assert.equal(result.billing.charged,'0');assert.equal((await budgets.read(scope,'shared')).spent,'100');assert.equal((await ledger.taskUsage(scope,'own-task')).providerTokens,'120');
}));
