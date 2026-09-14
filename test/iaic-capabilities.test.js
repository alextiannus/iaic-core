import test from 'node:test';
import assert from 'node:assert/strict';
import {defineCapability,CapabilityDispatcher} from '@immedi/iaic-core/capabilities/index.js';
const actor={scopeId:'E1',subjectId:'u@example.test'};
const input={type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false};
const output={type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false};
const define=(options={})=>defineCapability({name:'records.read',description:'Read a scoped record',input,output,effect:'read',
  authorize:async()=>true,implementation:{kind:'function',execute:async value=>value},...options});
test('all entry projections use validation and current authorization from the same definition',async()=>{
  let permitted=true,calls=0;
  const dispatcher=new CapabilityDispatcher({capabilities:[define({authorize:async()=>permitted,
    implementation:{kind:'function',execute:async value=>{calls++;return value;}}})]});
  const tool=dispatcher.toolsFor(actor)['records.read'];
  assert.deepEqual(await tool.handler({value:'one'}),await dispatcher.invoke('records.read',{value:'one'},{actor}));
  permitted=false; await assert.rejects(tool.handler({value:'one'}),{statusCode:403}); assert.equal(calls,2);
  await assert.rejects(tool.handler({value:'one',subjectId:'admin'}),{statusCode:400});
});
test('write verification failure is unknown and cannot be reported as success',async()=>{
  let writes=0;
  const dispatcher=new CapabilityDispatcher({capabilities:[define({effect:'write',retry:'idempotent',verify:async()=>false,
    implementation:{kind:'function',execute:async(value,ctx)=>{assert.equal(ctx.callId,'stable');writes++;return value;}}})]});
  await assert.rejects(dispatcher.invoke('records.read',{value:'one'},{actor}),/stable call ID/);
  await assert.rejects(dispatcher.invoke('records.read',{value:'one'},{actor,callId:'stable'}),{statusCode:422,outcomeUnknown:true});
  assert.equal(writes,1);
});
test('invalid outputs, missing identity and out-of-scope tools are rejected',async()=>{
  const dispatcher=new CapabilityDispatcher({capabilities:[define({implementation:{kind:'function',execute:async()=>({})}})]});
  await assert.rejects(dispatcher.invoke('records.read',{value:'one'},{actor}),{statusCode:502});
  await assert.rejects(dispatcher.invoke('records.read',{value:'one'}),{statusCode:401});
  await assert.rejects(dispatcher.invoke('records.read',{value:'one'},{actor,allowedCapabilities:[]}),{statusCode:403});
});
test('cancellation during authorization prevents operation admission',async()=>{
  const control=new AbortController();let calls=0;
  const dispatcher=new CapabilityDispatcher({capabilities:[define({authorize:async()=>{control.abort();return true;},
    implementation:{kind:'function',execute:async()=>{calls++;}}})]});
  await assert.rejects(dispatcher.invoke('records.read',{value:'one'},{actor,signal:control.signal}),{statusCode:409});assert.equal(calls,0);
});
test('duplicate definitions and recursive Agent tools are refused',()=>{
  assert.throws(()=>new CapabilityDispatcher({capabilities:[define(),define()]}),/Duplicate/);
  const agent=define({name:'reports.prepare',implementation:{kind:'agent',instructions:'Prepare',tools:['reports.prepare'],verify:async()=>true}});
  assert.throws(()=>new CapabilityDispatcher({capabilities:[agent]}),/deterministic/);
});

test('existing ERP service identities may call authorized functions but cannot start employee tasks',async()=>{
 const native={subjectId:'service@example.test'};
 const functionCapability=define({authorize:who=>who.subjectId===native.subjectId});
 const agent=define({name:'reports.prepare',implementation:{kind:'agent',instructions:'Prepare',tools:['records.read'],verify:async()=>true}});
 const dispatcher=new CapabilityDispatcher({capabilities:[functionCapability,agent]});
 assert.deepEqual(await dispatcher.invoke('records.read',{value:'native service'},{actor:native}),{value:'native service'});
 await assert.rejects(dispatcher.invoke('reports.prepare',{value:'goal'},{actor:native}),{statusCode:401});
});

test('read-only preflight rejects before writes and cancellation still blocks admission',async()=>{
 let writes=0;const control=new AbortController();
 const dispatcher=new CapabilityDispatcher({capabilities:[define({effect:'write',retry:'idempotent',preflight:async value=>{if(value.value==='cancel')control.abort();return value.value!=='invalid';},implementation:{kind:'function',execute:async value=>{writes++;return value;}}})]});
 await assert.rejects(dispatcher.invoke('records.read',{value:'invalid'},{actor,callId:'a'}),error=>error.preflightRejected===true&&!error.outcomeUnknown);assert.equal(writes,0);
 await assert.rejects(dispatcher.invoke('records.read',{value:'cancel'},{actor,callId:'b',signal:control.signal}),{statusCode:409});assert.equal(writes,0);
 await dispatcher.invoke('records.read',{value:'valid'},{actor,callId:'c'});assert.equal(writes,1);
});

test('structured preflight feedback is public across entry projections and cannot bypass validation or authorization',async()=>{
 let writes=0,checks=0,permitted=true,result={valid:false,feedback:'/value must reference the current revision'};
 const dispatcher=new CapabilityDispatcher({capabilities:[define({effect:'write',retry:'idempotent',authorize:()=>permitted,preflight:()=>{checks++;return result;},implementation:{kind:'function',execute:async value=>{writes++;return value;}}})]});
 for(const invoke of [()=>dispatcher.invoke('records.read',{value:'old'},{actor,callId:'one'}),()=>dispatcher.toolsFor(actor)['records.read'].handler({value:'old'},{callId:'two'})]){
  await assert.rejects(invoke,error=>error.statusCode===422&&error.preflightRejected===true&&error.preflightFeedback===result.feedback&&error.message.includes(result.feedback)&&!error.outcomeUnknown);
 }
 assert.equal(writes,0);assert.equal(checks,2);
 permitted=false;await assert.rejects(dispatcher.invoke('records.read',{value:'old'},{actor,callId:'denied'}),error=>error.statusCode===403&&!error.preflightFeedback);assert.equal(checks,2);permitted=true;
 for(const invalid of [null,1,'yes',{}, {valid:true,extra:'not allowed'},{valid:true,feedback:''},{valid:false,feedback:'x'.repeat(2001)},{valid:true,feedback:undefined}]){
  result=invalid;await assert.rejects(dispatcher.invoke('records.read',{value:'one'},{actor,callId:'invalid'}),/Invalid capability preflight result/);
 }
 assert.equal(writes,0);result={valid:true};assert.deepEqual(await dispatcher.invoke('records.read',{value:'current'},{actor,callId:'valid'}),{value:'current'});assert.equal(writes,1);
});
