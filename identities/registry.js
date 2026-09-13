import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
const fail=(message,statusCode=400,code='AGENT_IDENTITY_INVALID')=>Object.assign(new Error(message),{statusCode,code});
const name=v=>typeof v==='string'&&/^[a-z][a-z0-9_.-]{0,99}$/.test(v);
// Configuration is host-owned JSON data: resource references and selections,
// never executable code or credentials. Canonical keys survive store round trips.
function configuration(value){
 let copy,text;
 try{text=JSON.stringify(value);copy=JSON.parse(text);}catch{throw fail('Agent configuration must be JSON data');}
 if(!value||typeof value!=='object'||Array.isArray(value)||!isDeepStrictEqual(value,copy)||Buffer.byteLength(text)>16384)throw fail('Agent configuration must be a JSON object within 16 KiB');
 const canonical=v=>{if(Array.isArray(v))return Object.freeze(v.map(canonical));if(v&&typeof v==='object')return Object.freeze(Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])));return v;};
 return canonical(copy);
}
function definition(value){
 if(!value||!name(value.id)||(value.role!=null&&(typeof value.role!=='string'||!value.role.trim()||value.role.length>100))||typeof value.purpose!=='string'||!value.purpose.trim()||value.purpose.length>4000||!Array.isArray(value.capabilities)||!value.capabilities.length||!value.capabilities.every(name)||new Set(value.capabilities).size!==value.capabilities.length)throw fail('Agent definition requires an ID, purpose and unique capability names; role is an optional label');
 const data={id:value.id,role:value.role??null,purpose:value.purpose,capabilities:[...value.capabilities].sort(),...(value.configuration!==undefined?{configuration:configuration(value.configuration)}:{})};
 return Object.freeze({...data,capabilities:Object.freeze(data.capabilities),revision:createHash('sha256').update(JSON.stringify(data)).digest('hex')});
}
const binding=(agent,instance)=>({instanceId:instance.id,definitionId:agent.id,definitionRevision:agent.revision,role:agent.role,purpose:agent.purpose});
export class AgentRegistry {
 constructor({store,definitions=[],resolveScope,authorizeStateChange}){
  this.store=store;this.resolveScope=resolveScope;this.authorizeStateChange=authorizeStateChange;
  this.definitions=new Map();
  for(const value of definitions)this.register(value);
 }
 // Trusted application API. Persist and distribute configuration in the host;
 // the in-process revision comparison is not a distributed database transaction.
 register(value,{expectedRevision=null}={}){
  const agent=definition(value),current=this.definitions.get(agent.id);
  if((current?.revision??null)!==expectedRevision)throw fail('Duplicate Agent definition or configuration revision changed',409);
  this.definitions.set(agent.id,agent);return agent;
 }
 definition(id){const value=this.definitions.get(id);if(!value)throw fail('Agent definition not found',404);return value;}
 async scope(actor,id){this.definition(id);const scope=await this.resolveScope(actor,id);return {applicationId:scope?.applicationId,subjectId:scope?.subjectId,definitionId:id};}
 async describe(actor,id){const definition=this.definition(id),scope=await this.scope(actor,id);return {definition,instance:await this.store.get(scope)};}
 async history(actor,id,input){return this.store.history(await this.scope(actor,id),input);}
 async bind(actor,id,capability){
  const agent=this.definition(id);if(!agent.capabilities.includes(capability))throw fail('Capability is outside Agent responsibility',403);
  const scope=await this.scope(actor,id),instance=await this.store.ensure(scope);
  if(this.definition(id).revision!==agent.revision)throw fail('Agent configuration changed during binding; retry admission',409);
  if(instance.state!=='active')throw fail('Agent is paused; reactivate it before admitting work',409,'AGENT_PAUSED');
  return binding(agent,instance);
 }
 async check(actor,reference,capability){
  if(!reference||typeof reference!=='object')throw fail('Task has no Agent identity binding',409);
  const agent=this.definition(reference.definitionId);
  if(!agent.capabilities.includes(capability))throw fail('Capability is outside Agent responsibility',403);
  const scope=await this.scope(actor,agent.id),instance=await this.store.get(scope);
  if(this.definition(agent.id).revision!==agent.revision||!instance||!isDeepStrictEqual(binding(agent,instance),reference))throw fail('Agent binding or definition revision changed; original task binding cannot be rewritten',409);
  if(instance.state!=='active')throw fail('Agent is paused; reactivate it and explicitly resume waiting tasks',409,'AGENT_PAUSED');
  return reference;
 }
 async setState(actor,id,input){
  const scope=await this.scope(actor,id);
  if(typeof this.authorizeStateChange!=='function'||await this.authorizeStateChange(actor,id,input)!==true)throw fail('Agent lifecycle access denied',403);
  return this.store.setState(scope,input);
 }
}
