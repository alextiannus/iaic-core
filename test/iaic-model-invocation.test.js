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
 const changed=new UserModels({...config,endpoints:[{...endpoint,invocation:{toolChoice:'required',maxCompletionTokens:8192}}]});
 assert.equal(changed.metadata(row).available,false);assert.equal(changed.endpoints()[0].invocation.toolChoice,'required');
 assert.equal(changed.endpoints()[0].invocation.maxCompletionTokens,8192);
});

test('total completion budget maps to the supported field and preserves usage on truncation',async()=>{
 for(const provider of ['openai','chat-completions']){
  let calls=0,wire;
  const model=createModelProvider({apiKey:'fixture',model:'fixture',provider,baseUrl:provider==='openai'?'':profile.baseUrl,maxOutputTokens:200,
   invocation:{maxCompletionTokens:8192},fetchImpl:async(_url,options)=>{
    calls++;wire=JSON.parse(options.body);
    return Response.json(provider==='openai'?{status:'incomplete',usage:{input_tokens:10,output_tokens:8192,output_tokens_details:{reasoning_tokens:8000}}}:
     {choices:[{finish_reason:'length',message:{content:'partial answer',reasoning_content:'private reasoning'}}],usage:{prompt_tokens:10,completion_tokens:8192,completion_tokens_details:{reasoning_tokens:8000}}});
   }});
  await assert.rejects(model.next(request),error=>error.usage.outputTokens===8192&&error.usage.reasoningOutputTokens===8000&&!error.invalidAction);
  assert.equal(calls,1);assert.equal(wire[provider==='openai'?'max_output_tokens':'max_completion_tokens'],8192);
  assert.equal(Object.hasOwn(wire,'max_tokens'),false);
  assert.equal(JSON.stringify(wire).includes('private reasoning'),false);
 }
});
test('changed total completion budget fences old profile identity before resolving secrets',async()=>{
 let secrets=0,received;
 const make=limit=>new ModelProfiles({profiles:[{...profile,invocation:{maxCompletionTokens:limit}}],resolveSecret:async()=>{secrets++;return 'fixture';},factory:value=>{received=value;return {next:async()=>({})};}});
 const old=make(4096),current=make(8192);
 await assert.rejects(current.resolve(profile.id,{expectedIdentity:old.list()[0].modelIdentity}),{statusCode:409});assert.equal(secrets,0);
 await current.resolve(profile.id);assert.equal(received.invocation.maxCompletionTokens,8192);assert.equal(secrets,1);
 for(const limit of [0,-1,1.5,'8192',null,undefined,1048577,Infinity])assert.throws(()=>make(limit));
});
test('unsupported total completion field is not silently replaced with a visible-output limit',async()=>{
 let calls=0;const model=createModelProvider({apiKey:'fixture',model:'fixture',provider:'chat-completions',baseUrl:profile.baseUrl,invocation:{maxCompletionTokens:8192},fetchImpl:async()=>{calls++;return new Response('',{status:400});}});
 await assert.rejects(model.next(request),{providerStatus:400});assert.equal(calls,1);
});
