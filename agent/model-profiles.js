import {createHash} from 'node:crypto';
import {createModelProvider} from './model-provider.js';
// Profiles describe model configuration, not memory or business authority.
// Credentials are resolved only while constructing the provider and are never
// included in the public profile or the persistent model revision identity.
export class ModelProfiles{
 #profiles=new Map();#resolveSecret;#factory;
 constructor({profiles,resolveSecret,factory=createModelProvider}){
  if(!Array.isArray(profiles)||!profiles.length||typeof resolveSecret!=='function')throw new Error('Model profiles and credential resolver required');
  this.#resolveSecret=resolveSecret;this.#factory=factory;
  for(const value of profiles){
   if(!value||!/^[a-z][a-z0-9_-]{0,63}$/.test(value.id||'')||typeof value.model!=='string'||!value.model.trim()||value.model.length>200
    ||!['openai','chat-completions'].includes(value.provider)||typeof value.credentialRef!=='string'||!value.credentialRef.trim())throw new Error('Invalid model profile');
   if(this.#profiles.has(value.id))throw new Error('Duplicate model profile');
   const profile=Object.freeze({id:value.id,label:typeof value.label==='string'?value.label.slice(0,200):value.id,model:value.model,provider:value.provider,baseUrl:value.baseUrl||'',credentialRef:value.credentialRef});
   if(profile.provider==='openai'&&profile.baseUrl)throw new Error('OpenAI profile cannot override its endpoint');
   if(profile.provider==='chat-completions'){
    const url=new URL(profile.baseUrl);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('Model profile requires a plain HTTPS endpoint');
   }
   const revision=createHash('sha256').update(JSON.stringify(profile)).digest('hex');
   this.#profiles.set(profile.id,{profile,revision,modelIdentity:profile.id+':'+revision});
  }
 }
 list(){return [...this.#profiles.values()].map(({profile,revision,modelIdentity})=>({id:profile.id,label:profile.label,model:profile.model,provider:profile.provider,revision,modelIdentity}));}
 async resolve(id,{expectedIdentity=null}={}){
  const entry=this.#profiles.get(id);if(!entry)throw Object.assign(new Error('Model profile is unavailable'),{statusCode:404});
  if(expectedIdentity!==null&&entry.modelIdentity!==expectedIdentity)throw Object.assign(new Error('Model profile changed; the original task cannot silently switch models'),{statusCode:409});
  const key=await this.#resolveSecret(entry.profile.credentialRef);
  if(typeof key!=='string'||!key)throw Object.assign(new Error('Model credential is unavailable'),{statusCode:503});
  const provider=this.#factory({apiKey:key,model:entry.profile.model,provider:entry.profile.provider,baseUrl:entry.profile.baseUrl});
  return Object.freeze({name:entry.modelIdentity,profileId:id,model:entry.profile.model,next:request=>provider.next(request)});
 }
}
