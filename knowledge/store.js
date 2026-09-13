import fs from 'node:fs/promises';
import path from 'node:path';
const missing=()=>Object.assign(new Error('Knowledge is unavailable'),{statusCode:404});
// Developer-managed, read-only adapter. A database/remote store can implement
// the same describe/list/read port without exposing filesystem paths to callers.
export class FileKnowledgeStore{
 constructor({root,entries,maxBytes=60000}){
  if(!Array.isArray(entries)||entries.length>1000)throw new Error('Bounded knowledge manifest required');
  if(new Set(entries.map(e=>e.id)).size!==entries.length)throw new Error('Duplicate knowledge IDs');
  this.root=root;this.entries=structuredClone(entries);this.maxBytes=maxBytes;
 }
 async list(){return this.entries.map(({file,...metadata})=>structuredClone(metadata));}
 async describe(id){const entry=(await this.list()).find(e=>e.id===id);if(!entry)throw missing();return entry;}
 async read(id){
  const entry=this.entries.find(e=>e.id===id);if(!entry)throw missing();
  if(typeof entry.file!=='string'||path.isAbsolute(entry.file)||entry.file.split(/[\\/]/).includes('..'))throw new Error('Invalid knowledge resource');
  try{
   const root=await fs.realpath(this.root),file=await fs.realpath(path.resolve(root,entry.file));
   if(!file.startsWith(root+path.sep))throw new Error('Knowledge resource is outside its registered root');
   const stat=await fs.stat(file);if(!stat.isFile()||stat.size>this.maxBytes)throw new Error('Knowledge resource exceeds adapter limit');
   const bytes=await fs.readFile(file);if(bytes.length>this.maxBytes)throw new Error('Knowledge resource exceeds adapter limit');
   return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }catch(error){if(error.code==='ENOENT')throw missing();throw error;}
 }
}
