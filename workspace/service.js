// Trusted scope/source are supplied by the application, never model arguments.
export class AssistantWorkspace{
 constructor({store,resolveScope,sourceFor,lineage=null}){Object.assign(this,{store,resolveScope,sourceFor,lineage});}
 async list(actor,input={}){
  const page=await this.store.list(await this.resolveScope(actor,{access:'read',operation:'list'}),input);if(!this.lineage)return page;
  const items=[];for(const artifact of page.items)try{await this.lineage.check({actor,artifact});items.push(artifact);}catch(e){if(e.code!=='SOURCE_INVALIDATED')throw e;}
  return {...page,items};
 }
 async read(actor,input){const artifact=await this.store.read(await this.resolveScope(actor,{access:'read',operation:'read'}),input);if(this.lineage)await this.lineage.check({actor,artifact});return artifact;}
 async write(actor,input,context={}){const scope=await this.resolveScope(actor,{access:'write',operation:'write'});let source=await this.sourceFor(actor);if(this.lineage)source=await this.lineage.prepare({actor,input,source,context});return this.store.write(scope,{path:input.path,content:input.content,mediaType:input.mediaType,expectedRevision:input.expectedRevision??0,source});}
 async purgeInvalid(actor,input={}){
  if(!this.lineage?.authorizePurge)throw Object.assign(new Error('Trusted purge authorization port required'),{statusCode:503});
  const scope=await this.resolveScope(actor,{access:'write',operation:'purgeInvalid'}),page=await this.store.list(scope,input),removed=[];
  for(const artifact of page.items)try{await this.lineage.check({actor,artifact});}catch(error){
   if(error.code!=='SOURCE_INVALIDATED')throw error;
   if(await this.lineage.authorizePurge({actor,artifact,error})!==true)continue;
   // Compare-and-delete prevents a correction from being removed by an older scan.
   try{removed.push(await this.store.remove(scope,{path:artifact.reference.path,expectedRevision:artifact.reference.revision}));}catch(e){if(e.statusCode!==409)throw e;}
  }
  return {removed,nextCursor:page.nextCursor};
 }
 async remove(actor,input){return this.store.remove(await this.resolveScope(actor,{access:'write',operation:'remove'}),input);}
}
