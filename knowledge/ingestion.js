import {createHash} from 'node:crypto';
import {jsonValue,evidenceDigest} from '../evaluation/runner.js';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export const sourceIdValid=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,149}$/.test(value);
export function splitKnowledgeText(text,{chunkBytes=16000,maxSourceBytes=1000000,maxChunks=256}={}){
 if(!Number.isInteger(chunkBytes)||chunkBytes<4||chunkBytes>60000||!Number.isInteger(maxSourceBytes)||maxSourceBytes<1||maxSourceBytes>10000000||!Number.isInteger(maxChunks)||maxChunks<1||maxChunks>1000)throw fail('Bounded Knowledge chunk limits required');
 if(typeof text!=='string'||!text.length||text.includes('\0')||Buffer.from(text).toString('utf8')!==text)throw fail('Nonempty valid Unicode text without NUL required');
 if(Buffer.byteLength(text)>maxSourceBytes)throw fail('Knowledge source exceeds ingestion limit',413);
 const chunks=[];let current='',bytes=0,start=0;
 const append=()=>{chunks.push({text:current,byteStart:start,byteEnd:start+bytes});if(chunks.length>maxChunks)throw fail('Knowledge source exceeds chunk count',413);start+=bytes;current='';bytes=0;};
 for(const character of text){const size=Buffer.byteLength(character);if(bytes+size>chunkBytes)append();current+=character;bytes+=size;}
 if(current)append();return chunks;
}
export class KnowledgeIngestion{
 constructor({store,resolveSource,authorize,chunkBytes=16000,maxSourceBytes=1000000,maxChunks=256}){
  if(typeof store?.replaceSource!=='function'||typeof store?.withdrawSource!=='function'||typeof store?.sourceState!=='function'||typeof resolveSource!=='function'||typeof authorize!=='function')throw fail('Knowledge ingestion requires persistence, trusted source and authorization ports');
  splitKnowledgeText('x',{chunkBytes,maxSourceBytes,maxChunks});Object.assign(this,{store,resolveSource,authorize,chunkBytes,maxSourceBytes,maxChunks});
 }
 async allowed(actor,action,sourceId){if(!sourceIdValid(sourceId))throw fail('Valid Knowledge source ID required');if(await this.authorize(actor,{action,sourceId})!==true)throw fail('Knowledge ingestion denied',403);}
 async sync(actor,{sourceId,expectedRevision}){
  await this.allowed(actor,'sync',sourceId);
  const source=jsonValue(await this.resolveSource(actor,{sourceId}));
  if(!source||source.confirmed!==true||source.sourceId!==sourceId||typeof source.sourceRevision!=='string'||!source.sourceRevision.trim()||source.sourceRevision.length>500||!['text/plain','text/markdown'].includes(source.mediaType)||typeof source.reference!=='string'||!source.reference.trim()||source.reference.length>2000)throw fail('Confirmed versioned text source required',409);
  const chunks=splitKnowledgeText(source.text,this);
  const metadata={title:source.title,description:source.description,source:{kind:'ingested-text',reference:source.reference,sourceId,sourceRevision:source.sourceRevision,mediaType:source.mediaType,contentDigest:createHash('sha256').update(source.text).digest('hex')},policy:source.policy??{},expiresAt:source.expiresAt??null};
  if(typeof metadata.title!=='string'||!metadata.title.trim()||metadata.title.length>300||typeof metadata.description!=='string'||metadata.description.length>2000||!metadata.policy||typeof metadata.policy!=='object'||Array.isArray(metadata.policy)||metadata.expiresAt!==null&&(typeof metadata.expiresAt!=='string'||!Number.isFinite(Date.parse(metadata.expiresAt))))throw fail('Valid source metadata, policy and expiry required');
  if(metadata.expiresAt!==null)metadata.expiresAt=new Date(metadata.expiresAt).toISOString();
  if(Buffer.byteLength(JSON.stringify(metadata))>16000)throw fail('Knowledge metadata exceeds limit',413);
  await this.allowed(actor,'sync',sourceId);
  return this.store.replaceSource({sourceId,expectedRevision,metadata,chunks,digest:evidenceDigest({metadata,chunks})});
 }
 async state(actor,{sourceId}){await this.allowed(actor,'state',sourceId);return this.store.sourceState(sourceId);}
 async withdraw(actor,{sourceId,expectedRevision}){await this.allowed(actor,'withdraw',sourceId);return this.store.withdrawSource({sourceId,expectedRevision});}
}
