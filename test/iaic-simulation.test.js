import test from 'node:test';import assert from 'node:assert/strict';
import {LocalSimulation,createScriptedModel,CapabilityDispatcher} from '@immedi/iaic-core';
const actor={subjectId:'alice',scopeId:'local'};
function setup({loseResponse=false,retry='idempotent'}={}){
 let allowed=true;
 const world=new LocalSimulation({initialState:{count:0},resolveScope:a=>a.subjectId,maxOperations:2});
 const write=world.capability({definition:{name:'counter.add',description:'Simulated counter',input:{type:'integer'},output:{type:'integer'},effect:'write',retry,authorize:()=>allowed},reduce:({state,input})=>({state:{count:state.count+input},result:state.count+input}),loseResponse});
 return {world,write,dispatcher:new CapabilityDispatcher({capabilities:[write]}),deny:()=>{allowed=false;}};
}
test('Scripted model selects durable turns without mutable cursors or live fallbacks',async()=>{
 const steps=[{response:{type:'finish',result:{done:true},usage:{inputTokens:1,outputTokens:1}}},{error:{message:'fixture unavailable',providerStatus:429,providerNotCalled:true}}];
 const m=createScriptedModel({steps});steps[0].response.result.done=false;
 const request={billingContext:{taskId:'one',turn:1}};const r=await m.next(request);r.result.done=false;
 assert.equal((await m.next({...request,billingContext:{taskId:'two',turn:1}})).result.done,true);
 await assert.rejects(m.next({billingContext:{turn:2}}),{providerStatus:429});
 await assert.rejects(m.next({billingContext:{turn:3}}),{providerNotCalled:true});
 await assert.rejects(m.next({signal:AbortSignal.abort()}));
 assert.throws(()=>createScriptedModel({steps:[{response:{},error:{message:'both'}}]}));
});
test('Simulated writes preserve scoped original receipts after lost responses and current revocation',async()=>{
 const {world,write,dispatcher,deny}=setup({loseResponse:true});const context={actor,callId:'one'};
 await assert.rejects(dispatcher.invoke(write.name,2,context),{outcomeUnknown:true});
 assert.deepEqual(world.snapshot('alice'),{count:2});
 assert.deepEqual(await write.reconcile(2,context),{confirmed:true,result:2});
 assert.equal(await dispatcher.invoke(write.name,2,context),2);
 await assert.rejects(dispatcher.invoke(write.name,3,context),{statusCode:409});
 const other={actor:{...actor,subjectId:'bob'},callId:'one'};
 assert.deepEqual(await write.reconcile(2,other),{confirmed:false});
 await assert.rejects(dispatcher.invoke(write.name,4,other),{outcomeUnknown:true});
 assert.deepEqual(world.snapshot('bob'),{count:4});assert.deepEqual(world.snapshot('alice'),{count:2});
 await assert.rejects(dispatcher.invoke(write.name,1,{actor,callId:'three'}),{statusCode:409});
 deny();await assert.rejects(write.reconcile(2,context),{statusCode:403});await assert.rejects(write.revalidate(2,2,context),{statusCode:403});
});
test('Simulation retains never-replay rules, schema checking and isolated snapshots',async()=>{
 const {world,write,dispatcher}=setup({retry:'never-replay'});await assert.rejects(dispatcher.invoke(write.name,'bad',{actor,callId:'bad'}),{statusCode:400});
 assert.equal(await dispatcher.invoke(write.name,1,{actor,callId:'one'}),1);await assert.rejects(dispatcher.invoke(write.name,1,{actor,callId:'one'}),{statusCode:409});
 const snapshot=world.snapshot('alice');snapshot.count=999;assert.equal(world.snapshot('alice').count,1);
 assert.deepEqual(await write.reconcile(1,{actor,callId:'one'}),{confirmed:true,result:1});
});
test('Simulation rejects live hooks, asynchronous reducers and mutating reads',async()=>{
 const world=new LocalSimulation({initialState:{count:0},resolveScope:a=>a.subjectId}),definition={name:'counter.read',description:'Read fixture',input:{type:'object'},output:{type:'integer'},effect:'read',authorize:()=>true};
 assert.throws(()=>world.capability({definition:{...definition,implementation:{kind:'function',execute:()=>fetch('https://example.com')}},reduce:()=>({})}));
 for(const reduce of [async()=>({state:{count:1},result:1}),()=>({state:{count:1},result:1})]){
  const cap=world.capability({definition,reduce}),d=new CapabilityDispatcher({capabilities:[cap]});await assert.rejects(d.invoke(cap.name,{},{actor}));assert.equal(world.snapshot('alice').count,0);
 }
});
