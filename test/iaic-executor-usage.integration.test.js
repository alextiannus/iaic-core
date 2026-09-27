import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {TokenLedger} from '../billing/token-ledger.js';import {meteredModel} from '../billing/metered-model.js';
const url=process.env.SUBMISSION_TEST_DATABASE_URL;
test('trusted executor usage is independent of budgets and unknown attribution is not guessed',{skip:!url},async()=>{
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname));const admin=new Pool({connectionString:url}),schema='executor_usage_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
 try{const ledger=new TokenLedger({pool});await ledger.initialize();const scope={applicationId:'fixture',subjectId:'shared'},other={...scope,subjectId:'other'};
 await ledger.grant(scope,{reference:'fixture',amount:'1000',evidence:{secret:'not projected'}});
 const policy={maximum:'100',price:{revision:'one',input:'2',cachedInput:'1',output:'3'}};
 const model={name:'fixture',next:async()=>({usage:{inputTokens:10,outputTokens:4,cachedInputTokens:3},usageEvidence:{providerReference:'secret-reference',rawUsage:{secret:'raw'}}})};
 await meteredModel({model,ledger,scope,policy,executorId:'host:alpha'}).next({billingContext:{taskId:'known',turn:1,executorId:'forged'}});
 await assert.rejects(meteredModel({model:{name:'unknown',next:async()=>({})},ledger,scope,policy,executorId:'host:alpha'}).next({billingContext:{taskId:'unknown',turn:1}}),{code:'USAGE_RECONCILIATION_REQUIRED'});
 await meteredModel({model,ledger,scope,policy,mode:'BYOK'}).next({billingContext:{taskId:'legacy',turn:1,executorId:'forged'}});
 const now=new Date(),from=new Date(now.getTime()-60000).toISOString(),until=new Date(now.getTime()+60000).toISOString();
 const usage=await ledger.accountUsage(scope,{from,until});assert.equal(usage.complete,false);assert.equal(usage.groups.length,2);
 const alpha=usage.groups.find(g=>g.executorId==='host:alpha'),legacy=usage.groups.find(g=>g.executorId===null);
 assert.equal(alpha.providerTokens,'14');assert.equal(alpha.inputTokens,'10');assert.equal(alpha.cachedInputTokens,'3');assert.equal(alpha.platformUnits,'29');assert.equal(alpha.held,'100');assert.equal(alpha.pending,'1');assert.equal(legacy.providerTokens,'14');assert.equal(legacy.platformUnits,'0');
 assert.doesNotMatch(JSON.stringify(usage),/forged|secret|rawUsage/);assert.equal((await ledger.accountUsage(other,{from,until})).groups.length,0);
 assert.equal((await ledger.accountUsage(scope,{from:new Date(now.getTime()+120000).toISOString(),until:new Date(now.getTime()+180000).toISOString()})).groups.length,0);
 await assert.rejects(ledger.accountUsage(scope,{from:until,until:from}),{statusCode:400});await assert.rejects(ledger.accountUsage(scope,{from:'not-a-date',until}),{statusCode:400});
 assert.throws(()=>meteredModel({model,ledger,scope,policy:{...policy,budget:{id:'x',executor:'other'}},executorId:'host:alpha'}),/does not match/);
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
