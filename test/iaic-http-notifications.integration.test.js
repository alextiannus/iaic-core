import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {createServer} from 'node:http';import {Pool} from 'pg';
import {createHttpNotificationChannel,PostgresNotificationStore,Notifications} from '@immedi/iaic-core';
async function fixture(run){
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;assert.ok(connectionString);const schema='http_notify_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
 const state={sends:0,receipts:new Map(),loseResponse:false,wrongReceipt:false,allowed:true,token:'fixture-token',seenHeaders:[],notSent:false};
 const server=createServer(async(req,res)=>{
  state.seenHeaders.push(req.headers.authorization);
  const url=new URL(req.url,'http://fixture');res.setHeader('content-type','application/json');
  if(req.method==='POST'){
   let text='';for await(const chunk of req)text+=chunk;const payload=JSON.parse(text),id=req.headers['idempotency-key'];assert.equal(payload.recipient,'host-resolved-recipient');
   if(!state.receipts.has(id)){state.sends++;state.receipts.set(id,{idempotencyKey:id,status:state.notSent?'not_sent':'delivered',reference:'provider-'+state.sends});}
   if(state.loseResponse){req.socket.destroy();return;}res.end(JSON.stringify(state.wrongReceipt?{...state.receipts.get(id),idempotencyKey:'other'}:state.receipts.get(id)));
  }else{const found=state.receipts.get(url.searchParams.get('key'));if(!found){res.statusCode=404;res.end('{}');}else res.end(JSON.stringify(found));}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const options={baseUrl:`http://127.0.0.1:${server.address().port}/api/`,resolveHeaders:()=>({authorization:'Bearer '+state.token}),idempotencyHeader:'Idempotency-Key',bindings:{send:{request:input=>({path:'send',body:{recipient:'host-resolved-recipient',message:input.message}}),project:body=>body},query:{request:input=>({path:'receipt',query:{key:input.idempotencyKey}}),project:body=>body}}};
  const store=new PostgresNotificationStore({pool,namespace:'app'});await store.initialize();const channel=createHttpNotificationChannel(options),build=()=>new Notifications({store,resolveScope:a=>a.subjectId,authorize:a=>a.subjectId==='owner',resolveDelivery:async()=>({allowed:state.allowed,...channel})});
  await run({state,store,channel,build,options});
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
const actor={subjectId:'owner'},request={requestKey:'one',recipientId:'owner',channel:'http-fixture',message:{text:'Synthetic notification'}};
test('Lost HTTP send acknowledgement reconciles the original outbox item without another send',()=>fixture(async({state,build})=>{
 const service=build();await service.enqueue(actor,request);state.loseResponse=true;assert.equal((await service.tick()).state,'unknown');assert.equal(state.sends,1);assert.equal(await build().tick(),null);
 state.token='rotated-fixture-token';const result=await build().reconcile(actor,{requestKey:'one'});assert.equal(result.state,'delivered');assert.equal(state.sends,1);assert.deepEqual(state.seenHeaders,['Bearer fixture-token','Bearer rotated-fixture-token']);
 await assert.rejects(service.retry(actor,{requestKey:'one'}));
}));
test('Mismatched receipt remains unknown and revoked delivery permission prevents query',()=>fixture(async({state,build})=>{
 const service=build();await service.enqueue(actor,request);state.wrongReceipt=true;assert.equal((await service.tick()).state,'unknown');state.allowed=false;await assert.rejects(service.reconcile(actor,{requestKey:'one'}),{statusCode:409});assert.equal(state.seenHeaders.length,1);
}));
test('Missing query receipt never proves not-sent; only explicit provider terminal evidence can enable retry',()=>fixture(async({state,channel,build})=>{
 await assert.rejects(channel.query({idempotencyKey:'missing'}));
 state.notSent=true;const service=build();await service.enqueue(actor,request);assert.equal((await service.tick()).state,'failed');assert.equal((await service.retry(actor,{requestKey:'one'})).state,'pending');
}));
