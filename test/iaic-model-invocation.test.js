import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createModelProvider} from '@immedi/iaic-core/agent/model-provider.js';
import {ModelProfiles} from '@immedi/iaic-core/agent/model-profiles.js';
import {UserModels} from '@immedi/iaic-core/credentials/user-models.js';
const request={messages:[],tools:[{name:'read',description:'Read fixture',inputSchema:{type:'object'}}],outputSchema:{type:'object'},maxBatchCalls:4};
const profile={id:'assistant',label:'assistant',model:'fixture',provider:'chat-completions',baseUrl:'https://fixture.example',credentialRef:'key'};
test('explicit invocation policy reaches both transports and constrains returned batches',async()=>{
 for(const provider of ['openai','chat-completions']){
  let wire;
  const model=createModelProvider({apiKey:'fixture',model:'fixture',provider,baseUrl:provider==='openai'?'':profile.baseUrl,invocation:{toolChoice:'required',parallelToolCalls:false},fetchImpl:async(url,options)=>{
   wire=JSON.parse(options.body);const name=provider==='openai'?wire.tools[0].name:wire.tools[0].function.name;
   const calls=[1,2].map(()=>({type:'function',function:{name,arguments:'{}'}}));
   return Response.json(provider==='openai'?{status:'completed',usage:{input_tokens:3,output_tokens:2},output:calls.map(c=>({type:'function_call',...c.function}))}:{usage:{prompt_tokens:3,completion_tokens:2},choices:[{finish_reason:'tool_calls',message:{tool_calls:calls}}]});
  }});
  await assert.rejects(model.next(request),error=>error.invalidAction&&error.usage.inputTokens===3);
  assert.equal(wire.tool_choice,'required');assert.equal(wire.parallel_tool_calls,false);
  const messages=provider==='openai'?wire.input:wire.messages;assert.equal(messages.at(-1).role,'system');assert.match(messages.at(-1).content,/stricter one-action limit/);assert.deepEqual(request.messages,[]);
 }
});
test('unsupported explicit policy is not automatically downgraded or retried',async()=>{
 let calls=0;const model=createModelProvider({apiKey:'fixture',model:'fixture',provider:'chat-completions',baseUrl:profile.baseUrl,invocation:{toolChoice:'required'},fetchImpl:async()=>{calls++;return new Response('',{status:400});}});
 await assert.rejects(model.next(request),{providerStatus:400});assert.equal(calls,1);
});
test('policy revision rejects old tasks before secret access and preserves omitted legacy identity',async()=>{
 const legacy=new ModelProfiles({profiles:[profile],resolveSecret:async()=>''});
 assert.equal(legacy.list()[0].revision,createHash('sha256').update(JSON.stringify(profile)).digest('hex'));
 let secrets=0,received;const policy={parallelToolCalls:false,toolChoice:'required'};
 const changed=new ModelProfiles({profiles:[{...profile,invocation:policy}],resolveSecret:async()=>{secrets++;return 'fixture';},factory:config=>{received=config;return {next:async()=>({})};}});
 policy.toolChoice='auto';
 await assert.rejects(changed.resolve(profile.id,{expectedIdentity:legacy.list()[0].modelIdentity}),{statusCode:409});assert.equal(secrets,0);
 await changed.resolve(profile.id);assert.equal(received.invocation.toolChoice,'required');assert.ok(Object.isFrozen(received.invocation));
 for(const invocation of [null,[],{toolChoice:'none'},{parallelToolCalls:1},{unknown:true}])assert.throws(()=>new ModelProfiles({profiles:[{...profile,invocation}],resolveSecret:async()=>{secrets++;}}));
 assert.equal(secrets,1);
});
test('BYOK endpoint revision binds policy without changing omitted legacy endpoint identity',()=>{
 const endpoint={id:'fixture',label:'fixture',provider:'chat-completions',baseUrl:profile.baseUrl};
 const config={pool:{},encryptionKey:Buffer.alloc(32,1).toString('base64')};
 const old=new UserModels({...config,endpoints:[endpoint]});
 const row={id:'byok-fixture',endpoint_id:'fixture',endpoint_revision:createHash('sha256').update(JSON.stringify(endpoint)).digest('hex'),revoked:false};
 assert.equal(old.metadata(row).available,true);
 const changed=new UserModels({...config,endpoints:[{...endpoint,invocation:{toolChoice:'required'}}]});
 assert.equal(changed.metadata(row).available,false);assert.equal(changed.endpoints()[0].invocation.toolChoice,'required');
});
