import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaskControlCapabilities,CapabilityDispatcher} from '@immedi/iaic-core';
const id='11111111-1111-1111-1111-111111111111',actor={subjectId:'owner',scopeId:'app'};
test('Task controls share Runtime ports, bounded inputs and history refresh without transition replay',async()=>{
 let transitions=0,allowed=true,resultVisible=true;const row={id,capability:'work.run',status:'waiting',waiting_reason:'input',result:{value:42},input:{private:'source'},model:'private-model'};
 const runtime={get:async()=>{if(!resultVisible)throw Object.assign(new Error('Source revoked'),{statusCode:403});return row;},state:async()=>row,transition:async(_a,_id,request)=>{transitions++;assert.equal(request.action,'provide_input');assert.equal(request.input,'clarification');return {...row,status:'queued',waiting_reason:null};}};
 const caps=createTaskControlCapabilities({runtime,authorize:()=>allowed}),dispatcher=new CapabilityDispatcher({capabilities:caps});
 assert.deepEqual(await dispatcher.invoke('tasks.get',{id},{actor}),{id,capability:'work.run',status:'waiting',waitingReason:'input',result:{value:42},inputRequest:null});
 const supplied=await dispatcher.invoke('tasks.provide_input',{id,input:'clarification'},{actor,callId:'clarify'});assert.equal(supplied.status,'queued');assert.equal(Object.hasOwn(supplied,'result'),false);
 const definition=dispatcher.capabilities.get('tasks.provide_input');assert.equal(definition.retry,'never-replay');await definition.revalidate({id},supplied,{actor});assert.equal(transitions,1);
 resultVisible=false;await assert.rejects(dispatcher.invoke('tasks.get',{id},{actor}),{statusCode:403});assert.equal((await dispatcher.invoke('tasks.state',{id},{actor})).status,'waiting');
 await assert.rejects(dispatcher.invoke('tasks.provide_input',{id,input:'x'.repeat(8001)},{actor,callId:'large'}),{statusCode:400});assert.equal(transitions,1);
 allowed=false;await assert.rejects(dispatcher.invoke('tasks.state',{id},{actor}),{statusCode:403});
});
test('Task controls require explicit runtime ports and permit host namespace and projections',async()=>{
 assert.throws(()=>createTaskControlCapabilities({runtime:{get:()=>{}},authorize:()=>true}));
 const runtime={get:async()=>({id}),state:async()=>({id}),transition:async()=>({id})};
 const dispatcher=new CapabilityDispatcher({capabilities:createTaskControlCapabilities({runtime,authorize:()=>true,namespace:'jobs.tasks',project:(row,{operation})=>({id:row.id,operation})})});
 assert.deepEqual(await dispatcher.invoke('jobs.tasks.state',{id},{actor}),{id,operation:'state'});
});
