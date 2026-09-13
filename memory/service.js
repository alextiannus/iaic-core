// Application identity and source labels are injected; memory rules do not
// depend on ERP, model choice, web routes or an application singleton.
export class AssistantMemory {
 constructor({store,resolveScope,sourceFor,authorizeAssessment=null,assessmentSourceFor=null}){Object.assign(this,{store,resolveScope,sourceFor,authorizeAssessment,assessmentSourceFor});}
 get assessmentEnabled(){return typeof this.authorizeAssessment==='function'&&typeof this.assessmentSourceFor==='function';}
 async canAssess(actor,input){if(!this.assessmentEnabled)return false;await this.resolveScope(actor);return await this.authorizeAssessment(actor,input)===true;}
 async assess(actor,input){
  input=structuredClone(input);
  if(!this.assessmentEnabled)throw Object.assign(new Error('Memory assessment policy and assessor ports required'),{statusCode:503});
  const scope=await this.resolveScope(actor);
  if(await this.authorizeAssessment(actor,input)!==true)throw Object.assign(new Error('Memory assessment denied'),{statusCode:403});
  return this.store.assess(scope,{key:input.key,expectedRevision:input.expectedRevision,level:input.level,reason:input.reason,evidence:input.evidence,assessor:await this.assessmentSourceFor(actor)});
 }
 async dispute(actor,input){return this.store.dispute(await this.resolveScope(actor),{key:input.key,reason:input.reason,expectedRevision:input.expectedRevision,source:await this.sourceFor(actor)});}
 async resolveDispute(actor,input){return this.store.resolveDispute(await this.resolveScope(actor),{key:input.key,kind:input.kind,content:input.content,expectedRevision:input.expectedRevision,expiresAt:input.expiresAt??null,source:await this.sourceFor(actor)});}
 async read(actor,input){return this.store.read(await this.resolveScope(actor),{key:input.key});}
 async relearn(actor,input){const scope=await this.resolveScope(actor);return this.store.relearn(scope,{key:input.key,kind:input.kind,content:input.content,expectedRevision:input.expectedRevision,expiresAt:input.expiresAt??null,source:await this.sourceFor(actor)});}
 async list(actor,options={}){return this.store.list(await this.resolveScope(actor),options);}
 async remember(actor,input){
  const scope=await this.resolveScope(actor);
  return this.store.remember(scope,{key:input.key,kind:input.kind,content:input.content,expectedRevision:input.expectedRevision??0,expiresAt:input.expiresAt??null,source:await this.sourceFor(actor)});
 }
 async forget(actor,input){return this.store.forget(await this.resolveScope(actor),{key:input.key,expectedRevision:input.expectedRevision});}
 async import(actor,{requestKey,snapshot}){const scope=await this.resolveScope(actor);return this.store.import(scope,{requestKey,snapshot,source:await this.sourceFor(actor)});}
 async export(actor){return this.store.export(await this.resolveScope(actor));}
}
