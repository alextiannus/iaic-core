import test from 'node:test';
import assert from 'node:assert/strict';
import {OpenAIProvider} from '@immedi/iaic-core/agent/openai-provider.js';
const request={messages:[{role:'user',content:'Compare evidence'}],tools:[{name:'issues.read',description:'Read issue',inputSchema:{type:'object'}}],outputSchema:{type:'object'}};
const result=(name,args,extra={})=>({status:'completed',output:[{type:'reasoning',summary:[{text:'must never enter task logs'}]},{type:'function_call',name,arguments:JSON.stringify(args)}],...extra});
test('provider sends a single-action stateless request and keeps credentials out of model input',async()=>{
 let sent;const provider=new OpenAIProvider({apiKey:'fixture-key',model:'configured-model',fetchImpl:async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');sent=JSON.parse(options.body);
  assert.equal(options.headers.Authorization,'Bearer fixture-key');return new Response(JSON.stringify(result('issues_read',{id:'I1'},{usage:{input_tokens:4,output_tokens:2,total_tokens:6}})));
 }});
 const action=await provider.next(request);assert.equal(action.name,'issues.read');assert.equal(action.usage.totalTokens,6);
 assert.equal(sent.parallel_tool_calls,false);assert.equal(sent.store,false);assert.equal(sent.tool_choice,'required');
 assert.ok(!JSON.stringify(sent).includes('fixture-key'));assert.ok(!JSON.stringify(provider).includes('fixture-key'));
 assert.ok(!JSON.stringify(action).includes('must never'));assert.equal(action.usage.cachedInputTokens,null);
});
test('provider maps finish and wait while missing usage stays unavailable',async()=>{
 for(const [name,args,type] of [['iaic_finish',{result:{report:'R1'}},'finish'],['iaic_wait',{question:'Which customer?'},'wait']]){
  const provider=new OpenAIProvider({apiKey:'fixture-key',model:'configured-model',fetchImpl:async()=>new Response(JSON.stringify(result(name,args)))});
  const action=await provider.next(request);assert.equal(action.type,type);assert.equal(action.usage,null);
 }
});
test('provider refuses incomplete, multiple, malformed and unconfigured actions',async()=>{
 for(const body of [result('issues_read',{}, {status:'incomplete'}),result('unknown',{}),{status:'completed',output:[]},
  {status:'completed',output:[{type:'function_call',name:'issues_read',arguments:'broken'}]},
  {status:'completed',output:[...result('issues_read',{}).output,...result('issues_read',{}).output]}]){
  const provider=new OpenAIProvider({apiKey:'fixture-key',model:'configured-model',fetchImpl:async()=>new Response(JSON.stringify(body))});
  await assert.rejects(provider.next(request));
 }
});
test('provider errors do not expose upstream echoed credentials or prompts',async()=>{
 const provider=new OpenAIProvider({apiKey:'fixture-key',model:'configured-model',fetchImpl:async()=>new Response('echo fixture-key private-prompt',{status:401})});
 await assert.rejects(provider.next(request),error=>error.message==='Model API returned HTTP 401');
 assert.throws(()=>new OpenAIProvider({model:'configured-model'}),/must be configured/);
});

test('provider exposes only parsed retry timing from rate-limit responses',async()=>{
 for(const [header,expected] of [['2',2000],['invalid secret',undefined]]){
  const provider=new OpenAIProvider({apiKey:'fixture-key',model:'configured',fetchImpl:async()=>new Response('echo fixture-key',{status:429,headers:{'Retry-After':header}})});
  await assert.rejects(provider.next(request),error=>error.providerStatus===429&&error.retryAfterMs===expected&&!JSON.stringify(error).includes('fixture-key')&&!JSON.stringify(error).includes('invalid secret'));
 }
});

test('provider cancels oversized chunked responses before buffering the entire body',async()=>{
 let pulls=0,cancelled=false;
 const body=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(1_000_000));if(pulls===10)controller.close();},cancel(){cancelled=true;}},{highWaterMark:0});
 const provider=new OpenAIProvider({apiKey:'fixture-key',model:'configured-model',fetchImpl:async()=>new Response(body)});
 await assert.rejects(provider.next(request),/transport limit/);
 assert.equal(pulls,3);assert.equal(cancelled,true);
});
test('provider preserves UTF-8 characters split across transport chunks',async()=>{
 const bytes=Buffer.from(JSON.stringify(result('iaic_wait',{question:'哪个客户？'})));
 const body=new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();}});
 const provider=new OpenAIProvider({apiKey:'fixture-key',model:'configured-model',fetchImpl:async()=>new Response(body)});
 assert.equal((await provider.next(request)).question,'哪个客户？');
});

test('invalid model actions carry bounded-recovery metadata while transport failures do not',async()=>{
 const provider=new OpenAIProvider({apiKey:'fixture',model:'configured',fetchImpl:async()=>new Response(JSON.stringify(result('reports.save',{}, {usage:{input_tokens:3,output_tokens:2}})))});
 await assert.rejects(provider.next(request),error=>error.invalidAction===true&&error.usage.inputTokens===3&&error.message.includes('issues_read'));
 const failed=new OpenAIProvider({apiKey:'fixture',model:'configured',fetchImpl:async()=>new Response('unavailable',{status:503})});
 await assert.rejects(failed.next(request),error=>error.invalidAction!==true);
});

test('delegate is advertised and decoded only with an explicit Runtime schema',async()=>{
 let sent;const provider=new OpenAIProvider({apiKey:'fixture',model:'test',fetchImpl:async(_url,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify(result('iaic_delegate',{goal:'Draft',tools:[],successCriteria:'Draft exists'})));}});
 await assert.rejects(provider.next(request),/unconfigured/);assert.ok(!sent.tools.some(t=>t.name==='iaic_delegate'));
 const schema={type:'object'};assert.equal((await provider.next({...request,delegationSchema:schema})).type,'delegate');assert.deepEqual(sent.tools.find(t=>t.name==='iaic_delegate').parameters,schema);
});
