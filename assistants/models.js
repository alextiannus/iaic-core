import {meteredModel} from '../billing/metered-model.js';
const unavailable=()=>Object.assign(new Error('Assistant model configuration is unavailable'),{statusCode:503});

// Model selection and routing rules only. No environment, ERP, UI or task-table
// access: the application injects scope and configured module interfaces.
export class AssistantModels {
 constructor({settings,profiles=null,userModels=null,ledger,resolveScope,tokenPolicies=null}){
  Object.assign(this,{settings,profiles,userModels,ledger,resolveScope,tokenPolicies});
 }
 get configured(){return Boolean(this.profiles||this.userModels);}
 bootstrapModel(){
  const first=this.profiles?.list()[0];
  return first?{name:first.modelIdentity,model:first.model}:this.userModels?{name:'user-configured',model:'user-configured'}:null;
 }
 async available(scope){return [...(this.profiles?.list()||[]).map(p=>({...p,credentialMode:'SYSTEM_MANAGED'})),...(this.userModels?await this.userModels.list(scope):[])];}
 async snapshot(actor){
  const scope=await this.resolveScope(actor),saved=await this.settings.get(scope),profiles=await this.available(scope);
  return {byok:{enabled:Boolean(this.userModels),endpoints:this.userModels?.endpoints()||[]},profiles,selectedProfile:saved?.model_profile||profiles[0]?.id||null,revision:saved?.revision||0};
 }
 async profile(scope,id,options){
  if(typeof id==='string'&&id.startsWith('byok-')){if(!this.userModels)throw unavailable();return this.userModels.resolve(scope,id,options);}
  if(!this.profiles)throw unavailable();return this.profiles.resolve(id,options);
 }
 async select(actor,{profileId,expectedRevision=0}){
  const scope=await this.resolveScope(actor);await this.profile(scope,profileId);
  return this.settings.select(scope,profileId,expectedRevision);
 }
 async resolve({actor,modelIdentity=null}){
  const scope=await this.resolveScope(actor);
  if(modelIdentity){
   const profile=(await this.available(scope)).find(p=>p.modelIdentity===modelIdentity);
   if(!profile)throw Object.assign(new Error('Original task model profile is unavailable'),{statusCode:409});
   return this.meter(scope,await this.profile(scope,profile.id,{expectedIdentity:modelIdentity}));
  }
  const saved=await this.settings.get(scope);
  return this.meter(scope,await this.profile(scope,saved?.model_profile||(await this.available(scope))[0]?.id));
 }
 async target(actor,profileId){const scope=await this.resolveScope(actor);return this.meter(scope,await this.profile(scope,profileId));}
 async saveOwn(actor,input){const scope=await this.resolveScope(actor);if(!this.userModels)throw unavailable();return this.userModels.save(scope,input);}
 async revokeOwn(actor,{id}){const scope=await this.resolveScope(actor);if(!this.userModels)throw unavailable();return this.userModels.revoke(scope,id);}
 meter(scope,model){
  if(model.credentialMode==='BYOK')return meteredModel({model,ledger:this.ledger,scope,mode:'BYOK',policy:{maximum:0,price:{revision:'byok-no-platform-charge-v1',input:0,cachedInput:0,output:0}}});
  if(!this.tokenPolicies)throw Object.assign(new Error('Platform allowance policy is not configured'),{statusCode:503,code:'ALLOWANCE_POLICY_REQUIRED'});
  const policy=this.tokenPolicies[model.profileId];
  if(!policy)throw Object.assign(new Error('Platform allowance rule is unavailable for this model'),{statusCode:503});
  return meteredModel({model,ledger:this.ledger,scope,policy});
 }
}
