import test from 'node:test';
import assert from 'node:assert/strict';
import {ModelProfiles} from '@immedi/iaic-core/agent/model-profiles.js';
const profile={id:'assistant',provider:'chat-completions',model:'model-a',baseUrl:'https://model.example/v1',credentialRef:'server-model-key'};
test('model selection resolves credentials without exposing them and binds a revision',async()=>{
 let config,reference;const registry=new ModelProfiles({profiles:[profile],resolveSecret:async ref=>{reference=ref;return 'private-key';},factory:args=>{config=args;return {next:async request=>({request,model:args.model})};}});
 const [publicProfile]=registry.list();assert.equal(publicProfile.credentialRef,undefined);assert.equal(publicProfile.baseUrl,undefined);
 const model=await registry.resolve('assistant',{expectedIdentity:publicProfile.modelIdentity});
 assert.equal(reference,'server-model-key');assert.equal(config.apiKey,'private-key');assert.equal((await model.next({goal:'test'})).model,'model-a');
 assert.ok(!JSON.stringify(model).includes('private-key'));
 const changed=new ModelProfiles({profiles:[{...profile,model:'model-b'}],resolveSecret:async()=>{throw new Error('Should not resolve changed task');}});
 await assert.rejects(changed.resolve('assistant',{expectedIdentity:model.name}),{statusCode:409});
});
test('missing profile or credential does not silently fall back',async()=>{
 let calls=0;const registry=new ModelProfiles({profiles:[profile],resolveSecret:async()=>null,factory:()=>{calls++;}});
 await assert.rejects(registry.resolve('other'),{statusCode:404});await assert.rejects(registry.resolve('assistant'),{statusCode:503});assert.equal(calls,0);
 for(const baseUrl of ['http://model.example','https://user:pass@model.example','https://model.example?key=value'])assert.throws(()=>new ModelProfiles({profiles:[{...profile,baseUrl}],resolveSecret:async()=>''}));
});
