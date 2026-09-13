import {evidenceDigest,jsonValue} from '../evaluation/runner.js';
const fail=(message,statusCode=400,code='LINEAGE_UNRESOLVED')=>Object.assign(new Error(message),{statusCode,code});
const same=(a,b)=>evidenceDigest(a)===evidenceDigest(b);
const invalid=()=>fail('Workspace source changed or is unavailable',404,'SOURCE_INVALIDATED');
const text=v=>typeof v==='string'&&v.length>0&&v.length<=300&&!/[\x00-\x1f]/.test(v);
function references(value){
 if(!Array.isArray(value)||value.length>20)throw fail('At most 20 exact source references required');
 const seen=new Set();return value.map(v=>{
  if(!v||Object.keys(v).some(k=>!['kind','reference'].includes(k))||!v.reference)throw fail('Exact source reference required');
  const r=v.reference,keys={memory:['key','revision'],knowledge:['id','version'],workspace:['path','revision','digest']}[v.kind];
  if(!keys||Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k))||!text(r[keys[0]])||(v.kind==='knowledge'?! /^[a-f0-9]{64}$/.test(r.version):!Number.isSafeInteger(r.revision)||r.revision<1)||(v.kind==='workspace'&&! /^[a-f0-9]{64}$/.test(r.digest)))throw fail('Invalid source version reference');
  const item=jsonValue(v),id=evidenceDigest(item);if(seen.has(id))throw fail('Duplicate source reference');seen.add(id);return item;
 });
}
// References live atomically in the existing Artifact source metadata. No body copy,
// shared fact table or second content store is introduced.
export class WorkspaceLineage {
 constructor({capture,readMemory,readKnowledge,readWorkspace,maxNodes=100,maxDepth=10,authorizePurge=null}){
  if(typeof capture!=='function'||[readMemory,readKnowledge,readWorkspace].some(p=>p!==undefined&&typeof p!=='function')||!Number.isInteger(maxNodes)||maxNodes<1||maxNodes>1000||!Number.isInteger(maxDepth)||maxDepth<1||maxDepth>50||(authorizePurge!==null&&typeof authorizePurge!=='function'))throw fail('Lineage capture and current owner-read ports required');
  Object.assign(this,{capture,readMemory,readKnowledge,readWorkspace,maxNodes,maxDepth,authorizePurge});
 }
 async prepare({actor,input,source,context={}}){
  const refs=references(await this.capture({actor,input,source,context}));
  if(refs.some(r=>r.kind==='workspace'&&r.reference.path===input.path))throw fail('Derived Workspace sources must use another document path');
  const value={...source,lineage:{format:'iaic.lineage.v1',references:refs}};
  await this.check({actor,artifact:{source:value}});return value;
 }
 async check({actor,artifact}){await this.walk(actor,artifact,{nodes:0,stack:new Set()},0);}
 async walk(actor,artifact,state,depth){
  const lineage=artifact.source?.lineage;
  if(!lineage||lineage.format!=='iaic.lineage.v1'||Object.keys(lineage).some(k=>!['format','references'].includes(k)))throw fail('Artifact has no supported lineage; explicit migration required',503);
  if(depth>this.maxDepth)throw fail('Source dependency depth exceeds the configured bound',503);
  for(const item of references(lineage.references)){
   if(++state.nodes>this.maxNodes)throw fail('Source dependency graph exceeds the configured bound',503);
   const id=evidenceDigest(item);if(state.stack.has(id))throw fail('Source dependency cycle',503);state.stack.add(id);
   const read=this[{memory:'readMemory',knowledge:'readKnowledge',workspace:'readWorkspace'}[item.kind]];
   if(typeof read!=='function')throw fail('Current source reader unavailable',503);
   let value;try{value=await read(actor,jsonValue(item.reference));}catch(e){if([403,404,409].includes(e.statusCode))throw invalid();throw e;}
   if(item.kind==='memory'){if(value?.status!=='active'||value.key!==item.reference.key||value.revision!==item.reference.revision)throw invalid();}
   else if(!value?.reference||!same(value.reference,item.reference))throw invalid();
   if(item.kind==='workspace')await this.walk(actor,value,state,depth+1);
   state.stack.delete(id);
  }
 }
}
