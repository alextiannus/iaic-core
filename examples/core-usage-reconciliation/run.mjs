import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';import {TokenLedger,UsageReconciler} from '@immedi/iaic-core';
const admin=new Pool({connectionString:process.env.DATABASE_URL}),schema='example_usage_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
try{
 const ledger=new TokenLedger({pool});await ledger.initialize();const scope={applicationId:'example',subjectId:'owner'},actor={id:'operator'};
 await ledger.grant(scope,{reference:'fixture',amount:100,evidence:{fixture:true}});
 await ledger.reserve(scope,{requestId:'original-call',mode:'SYSTEM_MANAGED',maximum:40,price:{revision:'original-rate',input:2,cachedInput:1,output:3},attribution:{taskId:'original-task'}});await ledger.markUnknown(scope,{requestId:'original-call',evidence:{reason:'missing-usage'}});
 const reconciler=new UsageReconciler({ledger,authorize:async a=>a===actor,resolveSource:async sourceId=>({sourceId,confirmed:true,scope,requestId:'original-call',outcome:'measured',providerReference:'fixture-export-request',usage:{input_tokens:5,output_tokens:2},evidence:{reference:'fixture-export-line'}})});
 const first=await reconciler.reconcile(actor,{sourceId:'line-1'}),again=await reconciler.reconcile(actor,{sourceId:'line-1'});assert.equal(first.receipt.id,again.receipt.id);assert.equal(first.receipt.delta,'-16');assert.equal((await ledger.balance(scope)).reserved,'0');assert.equal(await ledger.hasPendingTask(scope,'original-task'),false);
 console.log(JSON.stringify({status:'passed',originalRequest:true,idempotentSource:true,platformUnits:'16',erpUsed:false,providerInvoked:false}));
}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
