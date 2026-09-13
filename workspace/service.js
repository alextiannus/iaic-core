// Trusted scope/source are supplied by the application, never model arguments.
export class AssistantWorkspace{
 constructor({store,resolveScope,sourceFor}){Object.assign(this,{store,resolveScope,sourceFor});}
 async list(actor,input={}){return this.store.list(await this.resolveScope(actor),input);}
 async read(actor,input){return this.store.read(await this.resolveScope(actor),input);}
 async write(actor,input){return this.store.write(await this.resolveScope(actor),{path:input.path,content:input.content,mediaType:input.mediaType,expectedRevision:input.expectedRevision??0,source:await this.sourceFor(actor)});}
 async remove(actor,input){return this.store.remove(await this.resolveScope(actor),input);}
}
