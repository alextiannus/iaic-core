import test from 'node:test';import assert from 'node:assert/strict';
import {verificationResult} from '@immedi/iaic-core/agent/verification.js';
import {createAgentTaskCapabilities} from '@immedi/iaic-core';
test('verification preserves booleans and validates explicit bounded feedback without truthy success',()=>{
 assert.deepEqual(verificationResult(true),{verified:true});assert.deepEqual(verificationResult(false),{verified:false});
 assert.deepEqual(verificationResult({verified:false,feedback:'Correct the total'}),{verified:false,feedback:'Correct the total'});
 for(const value of [null,undefined,1,'true',{verified:1},{verified:true,extra:'ignored'},{verified:false,feedback:''},{verified:false,feedback:'x'.repeat(2001)}])assert.throws(()=>verificationResult(value));
});
test('Assistant composition preserves trusted outcome feedback after its artifact and evidence checks',async()=>{
 const result={verified:false,feedback:'Missing source citation'};
 const cap=createAgentTaskCapabilities({memory:{},workspace:{},authorize:()=>true,verifyOutcome:()=>result}).find(c=>c.name==='assistant.run');
 assert.deepEqual(await cap.implementation.verify({},{summary:'draft',artifacts:[]},{history:{calls:[{status:'succeeded',capability:'my_list_assistant_memories'}]}}),result);
 assert.equal(await cap.implementation.verify({},{summary:'draft',artifacts:[]},{history:{calls:[]}}),false);
});
