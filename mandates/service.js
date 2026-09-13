const fail=(message,statusCode=403)=>Object.assign(new Error(message),{statusCode,code:'MANDATE_DENIED'});
export class AssistantMandates {
 constructor({store,resolveScope,authorizeGrant,sourceFor,clock=()=>Date.now()}){Object.assign(this,{store,resolveScope,authorizeGrant,sourceFor,clock});}
 async grant(actor,input){
  const scope=await this.resolveScope(actor);
  if(typeof this.authorizeGrant!=='function'||await this.authorizeGrant(actor,input)!==true)throw fail('Mandate grant denied');
  return this.store.grant(scope,input,await this.sourceFor(actor));
 }
 async read(actor,id){return this.store.read(await this.resolveScope(actor),id);}
 async list(actor,input){return this.store.list(await this.resolveScope(actor),input);}
 async revoke(actor,id){return this.store.revoke(await this.resolveScope(actor),id);}
 async checkTask(actor,{capability,input,tool=null}){
  if(input.mandate===undefined)return null;
  const reference=input.mandate;
  if(!reference||typeof reference!=='object'||Array.isArray(reference)||Object.keys(reference).some(k=>k!=='id')||typeof reference.id!=='string')throw fail('Invalid task Mandate reference',400);
  const grant=await this.read(actor,reference.id);
  if(grant.revokedAt||Date.parse(grant.expiresAt)<=this.clock())throw fail('Mandate revoked or expired; subsequent execution is stopped');
  if(grant.capability!==capability||!Array.isArray(input.allowedTools)||!input.allowedTools.length||!input.allowedTools.every(name=>grant.tools.includes(name))||(tool!==null&&(!grant.tools.includes(tool)||!input.allowedTools.includes(tool))))throw fail('Task or action exceeds Mandate scope');
  return grant;
 }
}
export const mandateReferenceSchema={type:'object',properties:{id:{type:'string',pattern:'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'}},required:['id'],additionalProperties:false};
