import test from 'node:test';import assert from 'node:assert/strict';
import {AssistantMemory} from '@immedi/iaic-core/memory/service.js';import {memoryTools} from '@immedi/iaic-core/memory/tools.js';
test('standalone memory contracts use trusted non-ERP identity and source across tool entries',async()=>{
 const owner={uid:'user'},scope={applicationId:'standalone',assistantId:'helper',subjectId:'user'};let saved,reads=0;
 const store={remember:async(s,input)=>{assert.equal(s,scope);saved=input;return input;},export:async s=>{assert.equal(s,scope);reads++;return {format:'iaic.memory.export.v1',memories:[]};}};
 const memory=new AssistantMemory({store,resolveScope:async actor=>{if(actor!==owner)throw Object.assign(new Error('Denied'),{statusCode:403});return scope;},sourceFor:()=>({kind:'user-statement',reference:'user'})});
 const tools=Object.fromEntries(memoryTools(memory,owner).map(t=>[t.name,t]));
 await tools.my_remember_assistant_memory.handler({key:'language',kind:'preference',content:'Chinese',source:{kind:'verified-fact'}});assert.deepEqual(saved.source,{kind:'user-statement',reference:'user'});
 assert.equal((await tools.my_export_assistant_memories.handler({})).format,'iaic.memory.export.v1');await assert.rejects(memory.export({uid:'other'}),{statusCode:403});assert.equal(reads,1);
});
