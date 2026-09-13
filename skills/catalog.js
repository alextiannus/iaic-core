import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {skillMetadata} from './metadata.js';
const fail=(message,statusCode)=>Object.assign(new Error(message),{statusCode});
const locate=async file=>{try{return await fs.realpath(file);}catch(error){if(['ENOENT','ENOTDIR'].includes(error.code))throw fail('Skill resource not found',404);if(error.code==='EACCES')throw fail('Skill resource access denied',403);throw error;}};
// Applications register trusted Skill entrypoints. Discovery never grants a
// model access to arbitrary files or discovers uninstalled executable code.
export class SkillCatalog{
 constructor({root,entries,maxBytes=60000,selectEntries=null}){if(selectEntries!==null&&typeof selectEntries!=='function')throw new TypeError('selectEntries must be a function');this.root=root;this.entries=[...entries];this.maxBytes=maxBytes;this.selectEntries=selectEntries;}
 async selected(context){
  const entries=this.selectEntries?await this.selectEntries(context):this.entries;
  if(!Array.isArray(entries)||entries.some(entry=>typeof entry!=='string'||!this.entries.includes(entry))||new Set(entries).size!==entries.length)throw fail('Selected Skills must be unique registered entries',400);
  return [...entries];
 }
 async file(relative,packageRoot=null){
  const root=await locate(this.root),file=await locate(path.resolve(root,relative));
  if(!file.startsWith(root+path.sep))throw fail('Skill resource is outside the configured root',403);
  if(packageRoot&&!file.startsWith(packageRoot+path.sep))throw fail('Resource is outside its Skill package',403);
  const stat=await fs.stat(file);if(!stat.isFile()||stat.size>this.maxBytes)throw fail('Skill resource exceeds limit',413);
  const text=await fs.readFile(file,'utf8');if(Buffer.byteLength(text)>this.maxBytes)throw fail('Skill resource exceeds limit',413);
  return {text,version:createHash('sha256').update(text).digest('hex')};
 }
 async list(context={}){
  const result=[];
  for(const entry of await this.selected(context)){
   const {text,version}=await this.file(entry);
   result.push({id:entry,...skillMetadata(text,entry),version});
  }return result;
 }
 async read(id,{resource=null,expectedVersion=null,expectedResourceVersion=null}={},context={}){
  if(!(await this.selected(context)).includes(id))throw Object.assign(new Error('Skill not registered'),{statusCode:404});
  if(resource!==null&&(typeof resource!=='string'||!resource.trim()||path.isAbsolute(resource)))throw fail('Invalid Skill resource',400);
  const relative=resource===null?id:path.join(path.dirname(id),resource);
  const packageRoot=await locate(path.resolve(this.root,path.dirname(id)));
  const document=await this.file(id,packageRoot);
  skillMetadata(document.text,id);
  if(expectedVersion!==null&&expectedVersion!==document.version)throw Object.assign(new Error('Skill changed; discover the current revision before loading'),{statusCode:409});
  const loaded=resource===null?document:await this.file(relative,packageRoot);
  if(expectedResourceVersion!==null&&expectedResourceVersion!==loaded.version)throw Object.assign(new Error('Skill resource changed; read its current revision before loading'),{statusCode:409});
  return {id,resource,...loaded,skillVersion:document.version};
 }
}
