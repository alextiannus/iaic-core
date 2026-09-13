import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {BrowserDevices,PostgresDeviceOperations,createBrowserDeviceCapabilities,CapabilityDispatcher} from '@immedi/iaic-core';
async function fixture(run){const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;assert.ok(connectionString);const schema='devices_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});try{const store=new PostgresDeviceOperations({pool,namespace:'fixture'});await store.initialize();await run(store);}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}}
const input={deviceId:'browser',requestKey:'click',expectedUrl:'https://example.test/',action:{type:'click',selector:'#save'}};
test('device original receipt is scoped, immutable and currently authorized',()=>fixture(async store=>{
 let calls=0,allowed=true;const service=new BrowserDevices({store,resolveOwner:a=>a.id,resolveDevice:async()=>({execute:async()=>{calls++;return {status:'submitted'};},observe:async()=>({text:'fixture'})}),authorize:()=>allowed});
 const actor={id:'owner',subjectId:'owner'},dispatcher=new CapabilityDispatcher({capabilities:createBrowserDeviceCapabilities({devices:service})});
 assert.equal((await dispatcher.invoke('browser.act',input,{actor,callId:'operation'})).status,'submitted');assert.equal((await service.act(actor,input)).status,'submitted');assert.equal(calls,1);
 await assert.rejects(service.act(actor,{...input,action:{type:'click',selector:'#other'}}),{statusCode:409});await assert.rejects(service.result({id:'another'},input),{statusCode:404});
 allowed=false;await assert.rejects(service.result(actor,input),{statusCode:403});await assert.rejects(service.observe(actor,{deviceId:'browser'}),{statusCode:403});assert.equal(calls,1);
}));
test('unknown browser action cannot replay or be bypassed with a new key or owner',()=>fixture(async store=>{
 let effects=0;const service=new BrowserDevices({store,resolveOwner:a=>a.id,resolveDevice:async()=>({execute:async()=>{effects++;throw Error('lost acknowledgement after effect');}}),authorize:()=>true});
 await assert.rejects(service.act({id:'owner'},input),e=>e.outcomeUnknown===true);await assert.rejects(service.act({id:'owner'},input),e=>e.outcomeUnknown===true);
 await assert.rejects(service.act({id:'other'},{...input,requestKey:'new'}),/unresolved action/);assert.equal(effects,1);assert.equal((await service.result({id:'owner'},input)).status,'unknown');
}));
test('unsupported code and known preflight rejection do not become submitted effects',()=>fixture(async store=>{
 let calls=0;const service=new BrowserDevices({store,resolveOwner:()=> 'owner',resolveDevice:async()=>({execute:async()=>{calls++;throw Object.assign(Error('URL changed'),{preflightRejected:true});}}),authorize:()=>true});
 await assert.rejects(service.act({}, {...input,action:{type:'evaluate',code:'arbitrary()'}}),/Unsupported browser action/);assert.equal(calls,0);
 await assert.rejects(service.act({},input),/URL changed/);assert.equal((await service.act({},input)).status,'not-executed');assert.equal(calls,1);
}));

test('trusted original source and driver termination reconcile unknown action without replay',()=>fixture(async store=>{
 const {DeviceOperationReconciliation,createDeviceReconciliationCapability}=await import('@immedi/iaic-core');let calls=0,allowed=true,terminal=false,wrong=false;
 const service=new BrowserDevices({store,resolveOwner:a=>a.id,resolveDevice:async()=>({execute:async()=>{calls++;if(calls===1)throw Error('lost response');return {status:'submitted'};}}),authorize:()=>true});
 const actor={id:'owner',subjectId:'owner'};await assert.rejects(service.act(actor,input),e=>e.outcomeUnknown===true);
 const reconciliation=new DeviceOperationReconciliation({store,sourceScope:'fixture-host',resolveOwner:a=>a.id,authorize:()=>allowed,resolveSource:async(_a,ref)=>({...ref,confirmed:true,driverTerminal:terminal,operationDigest:wrong?'f'.repeat(64):ref.operationDigest,status:'submitted',reference:'trusted-original-receipt'})});
 const args={...input,sourceId:'source'};await assert.rejects(reconciliation.resolve(actor,args),{statusCode:409});terminal=true;wrong=true;await assert.rejects(reconciliation.resolve(actor,args),{statusCode:409});wrong=false;allowed=false;await assert.rejects(reconciliation.resolve(actor,args),{statusCode:403});allowed=true;
 const dispatcher=new CapabilityDispatcher({capabilities:[createDeviceReconciliationCapability({reconciliation})]});const request={deviceId:input.deviceId,requestKey:input.requestKey,sourceId:'source'};
 const recovered=await dispatcher.invoke('browser.reconcile',request,{actor,callId:'reconcile'});assert.equal(recovered.status,'submitted');assert.equal(recovered.evidence.driverTerminal,true);assert.equal(calls,1);
 assert.equal((await service.act(actor,input)).status,'submitted');assert.equal(calls,1);assert.equal((await service.act(actor,{...input,requestKey:'next'})).status,'submitted');assert.equal(calls,2);
 assert.deepEqual(await reconciliation.resolve(actor,request),recovered);await assert.rejects(store.complete(actor.id,input.requestKey,{status:'not-executed'}),{statusCode:409});allowed=false;await assert.rejects(reconciliation.resolve(actor,request),{statusCode:403});
}));

test('revocation during source lookup leaves the original device pending',()=>fixture(async store=>{
 const {DeviceOperationReconciliation}=await import('@immedi/iaic-core');await store.begin('owner',input);let allowed=true;
 const reconciliation=new DeviceOperationReconciliation({store,sourceScope:'fixture',resolveOwner:()=> 'owner',authorize:()=>allowed,resolveSource:async(_actor,ref)=>{allowed=false;return {...ref,confirmed:true,driverTerminal:true,status:'not-executed',reference:'confirmed-pre-dispatch'};}});
 await assert.rejects(reconciliation.resolve({}, {...input,sourceId:'source'}),{statusCode:403});assert.equal((await store.get('owner',input.requestKey)).result,null);
}));
