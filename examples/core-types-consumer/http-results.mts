import assert from 'node:assert/strict';
import {CapabilityHttpClient,CapabilityHttpError} from '@immedi/iaic-core/http/client.js';
import {defineCapability,CapabilityDispatcher} from '@immedi/iaic-core/capabilities/index.js';
import {createCapabilityHttpHandler} from '@immedi/iaic-core/http/server.js';
type Result={contextId:string};
type Contracts={'context.create':{input:{value:string};output:Result};'context.read':{input:{value:string};output:Result}};
let effects=0;
const receipts=new Map<string,Result>();
const schema={type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false};
const write=defineCapability<{value:string},Result>({name:'context.create',description:'Synthetic idempotent business write',input:schema,output:{type:'object'},effect:'write',retry:'idempotent',authorize:()=>true,
 preflight:input=>input.value!=='invalid',implementation:{kind:'function',execute:(input,{callId})=>{
  if(input.value==='conflict')throw Object.assign(Error('Conflict'),{statusCode:409,publicCode:'FIXTURE_CONFLICT'});
  assert.ok(callId);const prior=receipts.get(callId);if(prior)return prior;effects++;const result={contextId:input.value};receipts.set(callId,result);return result;
 }}});
const read=defineCapability<{value:string},Result>({name:'context.read',description:'Read original receipt',input:schema,output:{type:'object'},effect:'read',authorize:()=>true,implementation:{kind:'function',execute:input=>receipts.get(input.value)??{contextId:'missing'}}});
const dispatcher=new CapabilityDispatcher({capabilities:[write,read]});
const handler=createCapabilityHttpHandler({dispatcher,resolveAccess:()=>({actor:{subjectId:'fixture'},capabilities:['context.create','context.read']})});
const fetcher:typeof fetch=async(input,init)=>handler(new Request(input,init));
const client=new CapabilityHttpClient<Contracts>({url:'https://fixture/capabilities',fetch:fetcher});
const direct:Result=await client.invokeResult('context.create',{value:'created'},{requestKey:'original'});
assert.equal(direct.contextId,'created');
assert.deepEqual(await client.invoke('context.create',{value:'created'},{requestKey:'original'}),{resultKind:'capability-result',result:direct});
assert.equal(effects,1);assert.equal((await client.invokeResult('context.read',{value:'original'})).contextId,'created');
await assert.rejects(client.invokeResult('context.create',{value:'no-key'}),{statusCode:400,outcomeUnknown:false});assert.equal(effects,1);
// A write that throws after dispatch stays unknown even when its HTTP status is 409.
await assert.rejects(client.invokeResult('context.create',{value:'conflict'},{requestKey:'conflict'}),{statusCode:409,code:'FIXTURE_CONFLICT',outcomeUnknown:true});
await assert.rejects(client.invokeResult('context.create',{value:'invalid'},{requestKey:'invalid'}),{statusCode:422,outcomeUnknown:false});
// Lost acknowledgement after a committed write: explicit read reconciles its original key.
const lost=new CapabilityHttpClient<Contracts>({url:'https://fixture/capabilities',fetch:async(input,init)=>{await fetcher(input,init);throw Error('Disconnected');}});
await assert.rejects(lost.invokeResult('context.create',{value:'lost'},{requestKey:'lost'}),{outcomeUnknown:true,requestKey:'lost'});
assert.equal((await client.invokeResult('context.read',{value:'lost'})).contextId,'lost');assert.equal(effects,2);
const cases:Array<{response:()=>Response;code:string;status?:number}>=[
 {response:()=>new Response('not-json',{status:200}),code:'CAPABILITY_RESPONSE_UNAVAILABLE',status:200},
 {response:()=>new Response('not-json',{status:409}),code:'CAPABILITY_RESPONSE_UNAVAILABLE',status:409},
 {response:()=>Response.json({wrong:true}),code:'INVALID_CAPABILITY_RESPONSE',status:200},
 {response:()=>Response.json({resultKind:'capability-result'}),code:'INVALID_CAPABILITY_RESPONSE',status:200},
 {response:()=>Response.json({resultKind:'task-receipt',result:{id:'admitted'}},{status:202}),code:'UNEXPECTED_RESULT_KIND'},
 {response:()=>{const r=Response.json({resultKind:'capability-result',result:{contextId:'redirect'}});Object.defineProperty(r,'redirected',{value:true});return r;},code:'CAPABILITY_RESPONSE_UNAVAILABLE',status:200},
 {response:()=>{throw Error('Redirect rejected by fetch');},code:'CAPABILITY_RESPONSE_UNAVAILABLE'},
];
for(const scenario of cases){let attempts=0;const c=new CapabilityHttpClient<Contracts>({url:'https://fixture/capabilities',fetch:async(_url,init)=>{attempts++;assert.equal(init?.redirect,'error');return scenario.response();}});
 await assert.rejects(c.invokeResult('context.create',{value:'x'},{requestKey:'stable'}),error=>error instanceof CapabilityHttpError&&error.code===scenario.code&&error.outcomeUnknown===true&&error.requestKey==='stable'&&(scenario.status===undefined||error.statusCode===scenario.status));assert.equal(attempts,1);
}
if(false){
 // @ts-expect-error Business return type must not be an envelope.
 direct.result;
 // @ts-expect-error Contract input remains checked.
 client.invokeResult('context.create',{value:3});
 // @ts-expect-error Existing envelope API must not masquerade as TResult.
 const invalid:Result=await client.invoke('context.read',{value:'original'});void invalid;
}
console.log(JSON.stringify({typedBusinessResult:true,envelopeCompatible:true,readWrite:true,status409And422:true,badResponsesUnknown:true,originalKeyReconciliation:true,automaticRetries:0}));
