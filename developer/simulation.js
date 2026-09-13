import {defineCapability} from '../capabilities/index.js';
import {jsonValue,evidenceDigest} from '../evaluation/runner.js';
const fail=(message,statusCode=400,extra={})=>Object.assign(new Error(message),{statusCode,...extra});
const key=value=>{if(typeof value!=='string'||!value||value.length>1000)throw fail('Bounded simulation key required');return value;};

// Uses the durable Runtime turn, never a process-local response cursor.
export function createScriptedModel({name='local-simulation',steps}){
 key(name);const script=jsonValue(steps);
 if(!Array.isArray(script)||!script.length||script.length>100||script.some(s=>!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!['response','error'].includes(k))||Object.hasOwn(s,'response')===Object.hasOwn(s,'error')))throw fail('Simulation requires 1–100 response or error steps');
 for(const step of script)if(Object.hasOwn(step,'error')&&(!step.error||typeof step.error.message!=='string'||!step.error.message||Object.keys(step.error).some(k=>!['message','providerStatus','retryAfterMs','providerNotCalled','providerCompleted','invalidAction','usage'].includes(k))))throw fail('Invalid simulated provider error');
 return Object.freeze({name,simulation:true,next:async request=>{
  request.signal?.throwIfAborted();
  const turn=request.billingContext?.turn;
  if(!Number.isInteger(turn)||turn<1)throw fail('Runtime model turn required',400,{providerNotCalled:true});
  const step=script[turn-1];
  if(!step)throw fail('Simulation script exhausted',409,{providerNotCalled:true});
  if(step.error){const {message,...detail}=structuredClone(step.error);throw Object.assign(new Error(message),detail);}
  return structuredClone(step.response);
 }});
}

// A host-owned in-memory world. Reducers are trusted synchronous local code.
// No live implementation is copied or used as a fallback.
export class LocalSimulation {
 constructor({initialState,resolveScope,maxOperations=1000}){
  if(typeof resolveScope!=='function'||!Number.isInteger(maxOperations)||maxOperations<1||maxOperations>10000)throw fail('Simulation requires scope resolver and bounded operation capacity');
  this.initialState=jsonValue(initialState);this.resolveScope=resolveScope;this.maxOperations=maxOperations;this.states=new Map();this.receipts=new Map();
 }
 snapshot(scope){return structuredClone((this.states.has(key(scope))?this.states.get(scope):this.initialState));}
 capability({definition,reduce,loseResponse=false}){
  if(!definition||typeof reduce!=='function'||typeof loseResponse!=='boolean'||Object.hasOwn(definition,'implementation')||['reconcile','revalidate','preflight','verify','waitReady','projectHistoryInput'].some(k=>Object.hasOwn(definition,k)))throw fail('Supply simulation contracts and reducer, not live execution hooks');
  definition={...definition};
  const scopeFor=async(actor,input)=>{if(await definition.authorize(actor,input)!==true)throw fail('Simulation access denied',403);const scope=key(await this.resolveScope(actor));if(await definition.authorize(actor,input)!==true)throw fail('Simulation access denied',403);return scope;};
  const original=(scope,input,callId)=>{
   const id=JSON.stringify([scope,definition.name,key(callId)]),prior=this.receipts.get(id);
   if(prior&&prior.digest!==evidenceDigest(input))throw fail('Simulation key input conflict',409);
   return {id,prior};
  };
  const transition=(scope,input,actor)=>{
   const before=this.snapshot(scope),value=jsonValue(reduce({state:structuredClone(before),input:jsonValue(input),actor:jsonValue(actor)}));
   if(!value||!Object.hasOwn(value,'state')||!Object.hasOwn(value,'result')||Object.keys(value).some(k=>!['state','result'].includes(k)))throw fail('Reducer must return plain JSON state and result');
   if(definition.effect==='read'&&evidenceDigest(before)!==evidenceDigest(value.state))throw fail('Simulated read cannot change state');
   return value;
  };
  const execute=async(input,context)=>{
   context.signal?.throwIfAborted();const scope=await scopeFor(context.actor,input);context.signal?.throwIfAborted();
   if(definition.effect==='read')return transition(scope,input,context.actor).result;
   const {id,prior}=original(scope,input,context.callId);
   if(prior){if(definition.retry==='never-replay')throw fail('Simulated operation already admitted',409);return structuredClone(prior.result);}
   if(this.receipts.size>=this.maxOperations)throw fail('Simulation operation capacity exhausted',409);
   const value=transition(scope,input,context.actor);
   // No awaits between state transition and receipt: one local atomic boundary.
   this.states.set(scope,value.state);this.receipts.set(id,{digest:evidenceDigest(input),result:value.result});
   if(loseResponse)throw fail('Simulated response lost after operation committed',503,{outcomeUnknown:true});
   return structuredClone(value.result);
  };
  return defineCapability({...definition,simulation:true,implementation:{kind:'function',execute},
   revalidate:async(input,_result,context)=>{
    if(definition.effect==='read')return execute(input,context);
    const scope=await scopeFor(context.actor,input),{prior}=original(scope,input,context.callId);
    if(!prior)throw fail('Simulated original receipt unavailable',404);return structuredClone(prior.result);
   },
   ...(definition.effect==='write'?{reconcile:async(input,context)=>{
    const scope=await scopeFor(context.actor,input),{prior}=original(scope,input,context.callId);
    return prior?{confirmed:true,result:structuredClone(prior.result)}:{confirmed:false};
   }}:{})});
 }
}
