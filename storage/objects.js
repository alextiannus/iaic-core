import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export const objectDigest=bytes=>createHash('sha256').update(bytes).digest('hex');
const scopeKey=value=>{if(typeof value!=='string'||!value.trim()||value.length>2000)throw fail('Trusted object scope required',401);return objectDigest(Buffer.from(value));};
const reference=value=>{if(!value||!/^[a-f0-9]{64}$/.test(value.sha256)||!Number.isSafeInteger(value.byteLength)||value.byteLength<0)throw fail('Object digest and byte length required');return value;};
export class FileObjectStore{
 constructor({directory,maxBytes=33554432}){if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw fail('Positive object size limit required');this.directory=path.resolve(directory);this.maxBytes=maxBytes;}
 location(scope,ref){reference(ref);return path.join(this.directory,scopeKey(scope),ref.sha256.slice(0,2),ref.sha256);}
 async put(scope,bytes){
  if(!(bytes instanceof Uint8Array)||bytes.byteLength>this.maxBytes)throw fail('Object must be bytes within the configured limit',413);
  bytes=Buffer.from(bytes);const ref={sha256:objectDigest(bytes),byteLength:bytes.length},file=this.location(scope,ref),parent=path.dirname(file);
  await fs.mkdir(parent,{recursive:true});const temporary=path.join(parent,'.'+randomUUID()+'.tmp');
  try{await fs.writeFile(temporary,bytes,{flag:'wx',mode:0o600});try{await fs.link(temporary,file);}catch(error){if(error.code!=='EEXIST')throw error;}}finally{await fs.rm(temporary,{force:true});}
  await this.get(scope,ref);return ref;
 }
 async get(scope,ref){
  const file=this.location(scope,ref);if(ref.byteLength>this.maxBytes)throw fail('Object exceeds configured limit',413);
  let bytes;try{const stat=await fs.stat(file);if(stat.size!==ref.byteLength||stat.size>this.maxBytes)throw fail('Object size does not match reference',409);bytes=await fs.readFile(file);}catch(error){if(error.code==='ENOENT')throw fail('Object not found',404);throw error;}
  if(bytes.length!==ref.byteLength||objectDigest(bytes)!==ref.sha256)throw fail('Object content does not match reference',409);return bytes;
 }
 async remove(scope,ref){const file=this.location(scope,ref);try{await fs.unlink(file);return {removed:true};}catch(error){if(error.code==='ENOENT')return {removed:false};throw error;}}
}
export class ObjectStorage{
 constructor({store,resolveScope,authorize}){if(!store||['put','get','remove'].some(name=>typeof store[name]!=='function')||typeof resolveScope!=='function'||typeof authorize!=='function')throw fail('Object storage requires store, scope and authorization ports');Object.assign(this,{store,resolveScope,authorize});}
 async scope(actor,action,input){if(await this.authorize(actor,{action,input})!==true)throw fail('Object access denied',403);return this.resolveScope(actor);}
 async put(actor,bytes){return this.store.put(await this.scope(actor,'put',{byteLength:bytes?.byteLength}),bytes);}
 async get(actor,ref){return this.store.get(await this.scope(actor,'get',ref),ref);}
 async remove(actor,ref){return this.store.remove(await this.scope(actor,'remove',ref),ref);}
}
