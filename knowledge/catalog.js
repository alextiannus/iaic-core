import {createHash} from 'node:crypto';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/.test(value);
const version=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
// Knowledge is sourced reference material, not user memory, an executable
// method, or permission to mutate authoritative business facts.
export class KnowledgeCatalog{
 constructor({store,authorize,now=()=>Date.now(),maxBytes=60000}){
  if(typeof authorize!=='function')throw new Error('Knowledge authorization port required');
  Object.assign(this,{store,authorize,now,maxBytes});
 }
 async permitted(actor,entry){
  if(!identifier(entry.id)||typeof entry.title!=='string'||!entry.title.trim()||entry.title.length>300||typeof entry.description!=='string'||entry.description.length>2000||!entry.source?.kind||!entry.source?.reference)throw new Error('Invalid sourced knowledge metadata');
  if(entry.expiresAt!==undefined&&entry.expiresAt!==null){const time=Date.parse(entry.expiresAt);if(!Number.isFinite(time))throw new Error('Invalid knowledge expiry');if(time<=this.now())return false;}
  return await this.authorize(actor,entry)===true;
 }
 async document(actor,id){
  if(!identifier(id))throw fail('Invalid knowledge ID');
  const snapshot=this.store.snapshot?await this.store.snapshot(id):null;
  const entry=snapshot?snapshot.entry:await this.store.describe(id);
  if(await this.permitted(actor,entry)!==true)throw fail('Knowledge is unavailable',404);
  const text=snapshot?snapshot.text:await this.store.read(id);
  if(typeof text!=='string'||Buffer.byteLength(text)>this.maxBytes)throw fail('Knowledge exceeds content limit',413);
  // Metadata, provenance and access changes invalidate old references too.
  const revision=createHash('sha256').update(JSON.stringify(entry)).update('\0').update(text).digest('hex');
  return {id:entry.id,title:entry.title,description:entry.description,source:structuredClone(entry.source),expiresAt:entry.expiresAt??null,reference:{id:entry.id,version:revision},text};
 }
 async read(actor,{id,expectedVersion=null}){
  if(expectedVersion!==null&&!version(expectedVersion))throw fail('Invalid knowledge version');
  const result=await this.document(actor,id);
  if(expectedVersion!==null&&result.reference.version!==expectedVersion)throw fail('Knowledge changed; search and read its current version',409);
  return result;
 }
 async search(actor,{query='',after='',limit=20}={}){
  if(typeof query!=='string'||query.length>500||typeof after!=='string'||(after!==''&&!identifier(after))||!Number.isInteger(limit)||limit<1||limit>50)throw fail('Invalid knowledge search');
  const entries=await this.store.list();if(!Array.isArray(entries)||entries.length>1000)throw fail('Knowledge catalog exceeds this adapter scan limit',413);
  const found=[],needle=query.toLowerCase();
  for(const entry of entries.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
   if(entry.id<=after||!await this.permitted(actor,entry))continue;
   let document;try{document=await this.document(actor,entry.id);}catch(error){if(error.statusCode===404)continue;throw error;}
   if(![document.title,document.description,document.text].some(s=>s.toLowerCase().includes(needle)))continue;
   const {text,...metadata}=document;found.push(metadata);if(found.length>limit)break;
  }
  const more=found.length>limit,items=found.slice(0,limit);return {items,nextCursor:more?items.at(-1).id:null};
 }
 async revalidate(actor,reference){
  try{return await this.read(actor,{id:reference.id,expectedVersion:reference.version});}
  catch(error){if([404,409].includes(error.statusCode))return {unavailable:true,reference};throw error;}
 }
}
