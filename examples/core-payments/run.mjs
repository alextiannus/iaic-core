import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {PostgresPaymentStore,Payments,CapabilityDispatcher,createPaymentCapabilities} from '@immedi/iaic-core';
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');
const schema='payments_example_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
try{
 let store=new PostgresPaymentStore({pool,namespace:'example'});await store.initialize();let chargeCalls=0;const external=new Map(),actor={subjectId:'fixture-user'},scopeId='fixture-scope';
 const outcome=op=>({operationId:op.id,status:'succeeded',amount:op.amount,currency:op.currency,providerRef:'fixture:'+op.id});
 const provider={charge:async op=>{chargeCalls++;external.set(op.id,outcome(op));throw new Error('Provider captured but response was lost');},refund:async op=>{const result=outcome(op);external.set(op.id,result);return result;},query:async op=>external.get(op.id)||{operationId:op.id,status:'unknown',amount:op.amount,currency:op.currency}};
 let enabled=true;const make=()=>new Payments({store,provider,resolveScope:()=>scopeId,authorize:a=>enabled&&a.subjectId===actor.subjectId,resolveInvoice:sourceId=>({confirmed:true,scopeId,sourceId,currency:'USD',amount:'1000'})});
 let service=make(),dispatcher=new CapabilityDispatcher({capabilities:createPaymentCapabilities({payments:service})});
 const invoke=(name,input,key)=>dispatcher.invoke('payments.'+name,input,{actor,callId:key});
 const bill=await invoke('issue',{sourceId:'quote-v1'},'issue');
 assert.equal((await invoke('issue',{sourceId:'quote-v1'},'issue')).id,bill.id);
 const charge=await invoke('charge',{invoiceId:bill.id},'pay-once');assert.equal(charge.state,'unknown');assert.equal(chargeCalls,1);
 assert.equal((await invoke('charge',{invoiceId:bill.id},'pay-once')).id,charge.id);assert.equal(chargeCalls,1);
 await assert.rejects(invoke('charge',{invoiceId:bill.id},'pay-different'),{statusCode:409});
 store=new PostgresPaymentStore({pool,namespace:'example'});service=make();dispatcher=new CapabilityDispatcher({capabilities:createPaymentCapabilities({payments:service})});
 assert.equal((await invoke('reconcile',{id:charge.id},'reconcile')).state,'succeeded');assert.equal(chargeCalls,1);
 const refunds=await Promise.allSettled(['700','400'].map(amount=>invoke('refund',{invoiceId:bill.id,paymentId:charge.id,amount},'refund-'+amount)));
 assert.equal(refunds.filter(r=>r.status==='fulfilled').length,1);assert.equal(refunds.filter(r=>r.status==='rejected').length,1);
 const read=await invoke('read',{invoiceId:bill.id});assert.equal(read.paid,'1000');const remaining=(1000n-BigInt(read.refunded)).toString();
 await invoke('refund',{invoiceId:bill.id,paymentId:charge.id,amount:remaining},'remaining-refund');assert.equal((await invoke('read',{invoiceId:bill.id})).netPaid,'0');
 await assert.rejects(invoke('refund',{invoiceId:bill.id,paymentId:charge.id,amount:'1'},'over-refund'),{statusCode:409});
 assert.deepEqual((await invoke('history',{id:charge.id})).map(e=>e.kind),['prepared','running','unknown','succeeded']);
 enabled=false;await assert.rejects(invoke('read',{invoiceId:bill.id}),{statusCode:403});
 console.log(JSON.stringify({example:'core-payments',status:'passed',confirmedInvoiceSource:true,lostCaptureResponse:true,reconstructedReconciliation:true,noDuplicateCapture:true,concurrentRefundBound:true,platformAllowanceChanged:false,realPayments:false}));
}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
