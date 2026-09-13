import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export class ReleaseResources{
 constructor({releases,readResource,maxBytes=67108864,maxFiles=1000}){if(typeof releases?.check!=='function'||typeof readResource!=='function'||!Number.isSafeInteger(maxBytes)||maxBytes<1||!Number.isSafeInteger(maxFiles)||maxFiles<1)throw fail('Resource loader requires release checks, authorized reads and limits');Object.assign(this,{releases,readResource,maxBytes,maxFiles});}
 async materialize(actor,reference,{parentDirectory}){
  const manifest=await this.releases.check(actor,reference),resources=manifest.resources;
  if(!Array.isArray(resources)||resources.length>this.maxFiles)throw fail('Release resource list required');
  const names=new Set();let total=0;
  for(const item of resources){
   if(!item||typeof item.path!=='string'||!item.path||item.path.includes('\\')||item.path.includes('\0')||item.path.split('/').some(p=>!p||p==='.'||p==='..'||p.includes(':'))||!/^[a-f0-9]{64}$/.test(item.sha256)||!Number.isSafeInteger(item.byteLength)||item.byteLength<0||!Object.hasOwn(item,'reference'))throw fail('Invalid relative release resource or digest');
   if(names.has(item.path))throw fail('Duplicate release resource path');names.add(item.path);total+=item.byteLength;
   if(total>this.maxBytes)throw fail('Release resource size exceeds limit',413);
  }
  for(const name of names)for(const other of names)if(name!==other&&other.startsWith(name+'/'))throw fail('Release resource file/directory paths conflict');
  const directory=await fs.mkdtemp(path.join(path.resolve(parentDirectory),'iaic-release-'));
  try{
   for(const item of resources){
    const value=await this.readResource(actor,item.reference);
    if(!(value instanceof Uint8Array))throw fail('Resource reader must return bytes',502);
    if(value.byteLength!==item.byteLength)throw fail('Release resource size differs from its manifest',409);
    const bytes=Buffer.from(value);
    if(bytes.length!==item.byteLength||createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw fail('Release resource content differs from its manifest',409);
    const file=path.join(directory,item.path);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});
   }
   await this.releases.check(actor,reference);
   return {directory,releaseId:reference.releaseId,manifestDigest:reference.manifestDigest,files:resources.map(({path,sha256,byteLength})=>({path,sha256,byteLength}))};
  }catch(error){await fs.rm(directory,{recursive:true,force:true});throw error;}
 }
}
