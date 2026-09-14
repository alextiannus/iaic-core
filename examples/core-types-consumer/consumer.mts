import {defineCapability,CapabilityDispatcher,type Actor,type TaskReceipt,type ExecutionContext} from '@immedi/iaic-core/capabilities/index.js';
import {createCapabilityHttpHandler} from '@immedi/iaic-core/http/server.js';
import {CapabilityHttpClient,CapabilityHttpError} from '@immedi/iaic-core/http/client.js';
import {publicErrorFields,type CoreErrorFields} from '@immedi/iaic-core/capabilities/errors.js';
interface User extends Actor {organization: string}
type Input = {value: string};
type Output = {value: string};
type Contracts = {'records.write': {input: Input; output: Output}; 'agent.work': {input: {goal: string}; output: TaskReceipt}};
const actor:User={subjectId:'fixture',scopeId:'fixture-app',organization:'fixture-org'};
let writes=0,seen:ExecutionContext<User>|undefined;
const capability=defineCapability<Input,Output,User>({name:'records.write',description:'Typed synthetic write',input:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},output:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},effect:'write',retry:'idempotent',
 authorize:(a,input)=>a.organization==='fixture-org'&&input.value.length>0,
 preflight:input=>({valid:input.value!=='denied',feedback:'Use another fixture value'}),
 implementation:{kind:'function',execute:(input,context)=>{writes++;seen=context;return {value:input.value};}},
 revalidate:(_input,previous,{actor})=>actor.subjectId==='fixture'?previous:{value:'redacted'},
});
const work=defineCapability<{goal:string},{summary:string},User>({name:'agent.work',description:'Typed Agent admission',input:{type:'object',properties:{goal:{type:'string'}},required:['goal']},output:{type:'object',properties:{summary:{type:'string'}},required:['summary']},effect:'write',retry:'idempotent',authorize:a=>Boolean(a.scopeId),implementation:{kind:'agent',instructions:'Use the declared tools',tools:['records.write'],verify:(_input,result,{history})=>({verified:result.summary.length>0&&history.calls.length>0})}});
const dispatcher=new CapabilityDispatcher<Contracts,User>({capabilities:[capability,work],tasks:{create:async({actor,idempotencyKey})=>({id:'fixture-task',status:'queued',owner:actor.subjectId,requestKey:idempotencyKey})}});
const signal=new AbortController().signal;
const direct:Output=await dispatcher.invoke('records.write',{value:'direct'},{actor,callId:'direct',signal,allowedCapabilities:['records.write'],taskId:'00000000-0000-4000-8000-000000000001'});
if(direct.value!=='direct'||seen?.callId!=='direct'||seen?.taskId!=='00000000-0000-4000-8000-000000000001'||seen?.signal!==signal)throw Error('Typed context differs from runtime');
const handler=createCapabilityHttpHandler({dispatcher,resolveAccess:request=>request.headers.get('authorization')==='Bearer fixture'?{actor,capabilities:['records.write','agent.work']}:null});
const transport:typeof fetch=async(input,init)=>handler(new Request(input,init));
const client=new CapabilityHttpClient<Contracts>({url:'http://fixture/capabilities',fetch:transport,headers:()=>({authorization:'Bearer fixture'})});
const response=await client.invoke('records.write',{value:'http'},{requestKey:'http',signal});
if(response.resultKind!=='capability-result'||response.result.value!=='http')throw Error('HTTP contract differs');
const receipt=await dispatcher.invoke('agent.work',{goal:'fixture admission'},{actor,callId:'admission'});
if(receipt.status!=='queued'||receipt.owner!=='fixture')throw Error('Task admission contract differs');
try{await client.invoke('records.write',{value:'denied'},{requestKey:'denied'});throw Error('Expected preflight failure');}
catch(error){if(!(error instanceof CapabilityHttpError)||error.statusCode!==422||error.outcomeUnknown)throw error;}
const fields:CoreErrorFields={statusCode:409,publicCode:'FIXTURE_CONFLICT',outcomeUnknown:true};
if(publicErrorFields(fields).code!=='FIXTURE_CONFLICT'||writes!==2)throw Error('Error contract differs');

// Compile-only rejection checks; these must never execute.
if(false){
 // @ts-expect-error Invalid call context type.
 await dispatcher.invoke('records.write',{value:'x'},{actor,callId:7});
 // @ts-expect-error Allowed capabilities must be a list.
 await dispatcher.invoke('records.write',{value:'x'},{actor,allowedCapabilities:'records.write'});
 // @ts-expect-error Task ID is not a number.
 await dispatcher.invoke('records.write',{value:'x'},{actor,taskId:1});
 // @ts-expect-error Named contract rejects invalid input.
 await dispatcher.invoke('records.write',{value:3},{actor});
 // @ts-expect-error Wrong return type in a typed implementation.
 const bad:typeof capability.implementation={kind:'function',execute:()=>({value:3})};void bad;
 // @ts-expect-error Missing write retry contract.
 defineCapability({name:'bad.write',description:'bad',input:{},output:{},effect:'write',authorize:()=>true,implementation:{kind:'function',execute:()=>({})}});
 // @ts-expect-error HTTP access cannot omit actor identity.
 createCapabilityHttpHandler({dispatcher,resolveAccess:()=>({capabilities:[]})});
 // @ts-expect-error HTTP client rejects invalid named input.
 await client.invoke('records.write',{value:3});
}
console.log(JSON.stringify({typedCapabilityAndHttp:true,currentActor:true,callContext:true,taskAdmissionPort:true,preflightError:true,negativeCompileChecks:8,realAgentRuntime:false,rootTypes:false,peerTypes:false}));
