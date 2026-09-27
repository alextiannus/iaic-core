import test from 'node:test';import assert from 'node:assert/strict';import {capabilityExecutionLimits} from '../agent/execution-limits.js';
const dispatcher={capabilities:new Map([['agent.work',{implementation:{kind:'agent'}}],['source.read',{implementation:{kind:'function'}}]])};
test('host capability limits reject invalid bounds and freeze a private copy',()=>{
 for(const value of [null,[],{'missing':{maxCalls:40}},{'source.read':{maxCalls:40}},{'agent.work':{maxCalls:0}},{'agent.work':{maxTurns:1001}},{'agent.work':{maxCalls:1.2}},{'agent.work':{budget:40}}])assert.throws(()=>capabilityExecutionLimits(dispatcher,value));
 const input={'agent.work':{maxCalls:40,maxTurns:45}},limits=capabilityExecutionLimits(dispatcher,input);input['agent.work'].maxCalls=900;assert.equal(limits['agent.work'].maxCalls,40);assert.ok(Object.isFrozen(limits));assert.ok(Object.isFrozen(limits['agent.work']));
});
