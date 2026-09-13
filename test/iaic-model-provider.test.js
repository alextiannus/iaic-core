import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelProvider} from '@immedi/iaic-core/agent/model-provider.js';
const config={apiKey:'fixture-key',model:'configured-model',provider:'chat-completions',baseUrl:'https://provider.example/openai/v1'};
const request={messages:[{role:'user',content:'Read the issue'}],tools:[{name:'issues.read',description:'Read',inputSchema:{type:'object'}}],outputSchema:{type:'object'}};
const body=(calls,reason='tool_calls')=>({choices:[{finish_reason:reason,message:{tool_calls:calls,reasoning_content:'private reasoning'}}],usage:{prompt_tokens:7,completion_tokens:3,total_tokens:10}});
const call=(name,args)=>({type:'function',function:{name,arguments:JSON.stringify(args)}});
test('compatible provider sends native chat tools and preserves verified action and usage',async()=>{
 const signal=new AbortController().signal;
 const provider=createModelProvider({...config,fetchImpl:async(url,options)=>{
  assert.equal(url,'https://provider.example/openai/v1/chat/completions');assert.equal(options.signal,signal);
  assert.equal(options.headers.Authorization,'Bearer fixture-key');const sent=JSON.parse(options.body);
  assert.equal(sent.tools[0].function.name,'issues_read');assert.equal(sent.tool_choice,'auto');assert.equal(sent.parallel_tool_calls,false);
  assert.equal(sent.temperature,0);assert.equal(sent.stream,false);assert.equal(sent.max_tokens,4096);assert.deepEqual(sent.messages,request.messages);
  return new Response(JSON.stringify(body([call('issues_read',{id:'I1'})])));
 }});
 const result=await provider.next({...request,signal});assert.equal(result.name,'issues.read');assert.equal(result.usage.totalTokens,10);
 assert.ok(!JSON.stringify(result).includes('private reasoning'));assert.ok(!JSON.stringify(provider).includes('fixture-key'));
});
test('compatible provider refuses plain text, truncated, multiple and unconfigured actions',async()=>{
 for(const reply of [body([],'stop'),body([call('iaic_finish',{result:{}})],'length'),body([call('issues_read',{}),call('issues_read',{})]),body([call('unknown',{})])]){
  const provider=createModelProvider({...config,fetchImpl:async()=>new Response(JSON.stringify(reply))});
  await assert.rejects(provider.next(request));
 }
});
test('compatible provider maps finish and wait without exposing upstream failures',async()=>{
 for(const [name,args,type] of [['iaic_finish',{result:{ok:true}},'finish'],['iaic_wait',{question:'Which issue?'},'wait']]){
  const provider=createModelProvider({...config,fetchImpl:async()=>new Response(JSON.stringify(body([call(name,args)])))});
  assert.equal((await provider.next(request)).type,type);
 }
 const provider=createModelProvider({...config,fetchImpl:async()=>new Response('fixture-key',{status:401})});
 await assert.rejects(provider.next(request),{message:'Model API returned HTTP 401'});
});
test('provider selection validates endpoint and refuses silent misrouting',()=>{
 for(const baseUrl of ['http://provider.example','https://user:password@provider.example','https://provider.example?key=secret','https://provider.example/#fragment'])assert.throws(()=>createModelProvider({...config,baseUrl}));
 assert.throws(()=>createModelProvider({...config,provider:'unknown'}));
 assert.throws(()=>createModelProvider({...config,provider:'openai'}));
 assert.equal(createModelProvider({apiKey:'fixture',model:'default'}).name,'default');
});
test('compatible transport applies byte bounds before parsing',async()=>{
 let pulls=0,cancelled=false;
 const stream=new ReadableStream({pull(c){pulls++;c.enqueue(new Uint8Array(1_000_000));if(pulls===10)c.close();},cancel(){cancelled=true;}},{highWaterMark:0});
 const provider=createModelProvider({...config,fetchImpl:async()=>new Response(stream)});
 await assert.rejects(provider.next(request),/transport limit/);assert.equal(pulls,3);assert.equal(cancelled,true);
});

test('normal text completion is an invalid action, while truncation and provider interruption remain terminal',async()=>{
 for(const reason of ['stop','length','content_filter','insufficient_system_resource','untrusted-reason']){
  const reply=body([call('issues_read',{})],reason);reply.choices[0].message.content='private plain text';
  const provider=createModelProvider({...config,fetchImpl:async()=>new Response(JSON.stringify(reply))});
  await assert.rejects(provider.next(request),error=>{
   assert.equal(error.invalidAction,reason==='stop');assert.equal(error.usage.totalTokens,10);
   assert.ok(!error.message.includes('private plain text'));
   if(reason==='stop')assert.match(error.message,/received 0.*iaic_wait/);
   else assert.match(error.message,new RegExp('finish_reason='+(reason==='untrusted-reason'?'unknown':reason)));
   return true;
  });
 }
});

test('Explicit bounded batches preserve every configured call and reject mixed control actions',async()=>{
 let parallel;
 const provider=reply=>createModelProvider({...config,fetchImpl:async(_u,o)=>{parallel=JSON.parse(o.body).parallel_tool_calls;return new Response(JSON.stringify(reply));}});
 const multiple=body([call('issues_read',{id:'I1'}),call('issues_read',{id:'I2'})]);
 const result=await provider(multiple).next({...request,maxBatchCalls:2});assert.equal(parallel,true);assert.equal(result.type,'batch');assert.deepEqual(result.actions.map(a=>a.input.id),['I1','I2']);assert.equal(result.usage.totalTokens,10);
 await assert.rejects(provider(multiple).next(request),{invalidAction:true});
 for(const calls of [[call('issues_read',{}),call('iaic_finish',{result:{}})],[call('issues_read',{}),call('unknown',{})],[call('issues_read',{}),call('issues_read',{}),call('issues_read',{})]])await assert.rejects(provider(body(calls)).next({...request,maxBatchCalls:2}),{invalidAction:true});
});
