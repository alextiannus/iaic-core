import test from 'node:test';import assert from 'node:assert/strict';import Ajv from 'ajv';import {Delegations} from '@immedi/iaic-core/agent/delegation.js';
test('Delegation schema retains an empty explicit tool ceiling without emitting an invalid empty enum',()=>{
 const delegation=new Delegations({handoffs:{}}),input={allowedTools:[],delegation:{capability:'agent.run',maxModelCalls:2,timeoutMs:1000}},schema=delegation.schema({input});
 const validate=new Ajv().compile(schema);assert.equal(validate({goal:'Reason',successCriteria:'Return result',tools:[]}),true);assert.equal(validate({goal:'Reason',successCriteria:'Return result',tools:['undeclared']}),false);
 assert.equal(delegation.schema({input,handoff:{id:'child'}}),undefined);assert.equal(delegation.schema({input,delegation:{received:true}}),undefined);
});
