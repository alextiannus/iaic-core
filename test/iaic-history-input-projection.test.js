import test from 'node:test';import assert from 'node:assert/strict';import {ContextAssembler} from '@immedi/iaic-core/context/index.js';import {defineCapability} from '@immedi/iaic-core/capabilities/index.js';import {memoryTools} from '@immedi/iaic-core/memory/tools.js';
const definition={name:'resource.read',description:'Read',input:{type:'object'},output:{type:'object'},effect:'read',authorize:async()=>true,implementation:{kind:'function',execute:async()=>({})},revalidate:async()=>({})};
test('History projection leaves authorization, source revalidation and original durable arguments intact, including failed/unknown calls',async()=>{
 const original={secret:'old text',key:'resource'},calls=['succeeded','failed','unknown'].map((status,id)=>({id:String(id),capability:'resource.read',input:structuredClone(original),status,result:{}}));let authorizations=0,refreshes=0,projections=0;
 const capability=defineCapability({...definition,authorize:async(_actor,input)=>{authorizations++;assert.deepEqual(input,original);return true;},revalidate:async input=>{refreshes++;assert.deepEqual(input,original);return {current:true};},projectHistoryInput:(input,context)=>{projections++;assert.ok(context.callId);delete input.secret;return input;}});
 const context=new ContextAssembler({}),dispatcher={capabilities:new Map([[capability.name,capability]])},result=await context.revalidateHistory({history:{calls,events:[]},actor:{},dispatcher});
 assert.equal(authorizations,3);assert.equal(refreshes,1);assert.equal(projections,3);for(const call of result.calls){assert.deepEqual(call.input,{key:'resource'});assert.equal(call.inputProjected,true);}assert.deepEqual(calls[0].input,original);
 const denied={...capability,authorize:async()=>false,projectHistoryInput:()=>{throw new Error('Must not project before authorization');}};await assert.rejects(context.revalidateHistory({history:{calls},actor:{},dispatcher:{capabilities:new Map([[capability.name,denied]])}}),{statusCode:403});
 const invalid={...capability,projectHistoryInput:()=>null};await assert.rejects(context.revalidateHistory({history:{calls},actor:{},dispatcher:{capabilities:new Map([[capability.name,invalid]])}}),/must return an object/);
 assert.throws(()=>defineCapability({...definition,projectHistoryInput:'model controlled'}),/deterministic/);
});
test('Memory owns content-free historical arguments for writes, disputes, import snapshots and queries',()=>{
 const tools=memoryTools({},null),input={key:'key',kind:'note',content:'OLD_CONTENT',reason:'OLD_REASON',snapshot:{memories:[{content:'IMPORTED_CONTENT'}]},query:'OLD_QUERY',expectedRevision:3,expiresAt:null,requestKey:'import'};
 for(const name of ['my_remember_assistant_memory','my_relearn_assistant_memory','my_resolve_assistant_memory_dispute','my_dispute_assistant_memory','my_import_assistant_memories','my_list_assistant_memories']){
  const project=tools.find(t=>t.name===name).projectHistoryInput;const projected=project(input);assert.doesNotMatch(JSON.stringify(projected),/OLD_|IMPORTED_/);assert.equal(projected.snapshot,undefined);assert.deepEqual(project(null),{});
 }
 assert.equal(input.content,'OLD_CONTENT');assert.equal(tools.find(t=>t.name==='my_read_assistant_memory').projectHistoryInput,undefined);
});
