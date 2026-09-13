import {createHash} from 'node:crypto';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
function ordered(value,depth=0){
 if(depth>30)throw fail('Memory snapshot metadata is too deeply nested');
 if(Array.isArray(value))return value.map(v=>ordered(v,depth+1));
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k],depth+1)]));
 return value;
}
export function memoryImportSnapshot(snapshot){
 let encoded;try{encoded=JSON.stringify(snapshot);}catch{throw fail('Memory snapshot must be serializable JSON');}
 if(!encoded||Buffer.byteLength(encoded)>8_100_000)throw fail('Memory import exceeds synchronous snapshot limit',413);
 snapshot=JSON.parse(encoded);
 if(!snapshot||snapshot.format!=='iaic.memory.export.v1'||typeof snapshot.exportedAt!=='string'||!Number.isFinite(Date.parse(snapshot.exportedAt))||!Array.isArray(snapshot.memories))throw fail('A v1 memory export with an explicit exportedAt is required');
 if(snapshot.memories.length>1000||Buffer.byteLength(JSON.stringify(snapshot.memories))>8_000_000)throw fail('Memory import exceeds synchronous snapshot limit',413);
 const keys=new Set();
 const records=snapshot.memories.map(row=>{
  if(!row||typeof row.memory_key!=='string'||!row.memory_key.trim()||row.memory_key.length>200||keys.has(row.memory_key)||!['fact','note','preference'].includes(row.kind)||typeof row.content!=='string'||!row.content.trim()||row.content.length>8000||!Number.isInteger(row.revision)||row.revision<1||!row.source||typeof row.source!=='object'||Array.isArray(row.source)||typeof row.source.kind!=='string'||!row.source.kind.trim())throw fail('Invalid or duplicate imported memory');
  if(row.expires_at!==null&&(typeof row.expires_at!=='string'||!Number.isFinite(Date.parse(row.expires_at))))throw fail('Imported memory expiration required');
  keys.add(row.memory_key);
  return {key:row.memory_key,kind:row.kind,content:row.content,claimedSource:row.source,originalRevision:row.revision,expiresAt:row.expires_at===null?null:new Date(row.expires_at).toISOString()};
 }).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
 // Ignore storage/owner fields in imported exports; ownership comes only from
 // the authenticated scope. Historical revisions are claims, not local CAS.
 const normalized={exportedAt:new Date(snapshot.exportedAt).toISOString(),records};
 return {...normalized,digest:createHash('sha256').update(JSON.stringify(ordered(normalized))).digest('hex')};
}
export const memoryImportSchema={type:'object',properties:{requestKey:{type:'string',minLength:1,maxLength:200},snapshot:{type:'object',properties:{format:{const:'iaic.memory.export.v1'},exportedAt:{type:'string'},memories:{type:'array',maxItems:1000,items:{type:'object',properties:{memory_key:{type:'string',minLength:1,maxLength:200},kind:{enum:['fact','preference','note']},content:{type:'string',minLength:1,maxLength:8000},source:{type:'object'},revision:{type:'integer',minimum:1},expires_at:{type:['string','null']}},required:['memory_key','kind','content','source','revision','expires_at']}}},required:['format','exportedAt','memories']}},required:['requestKey','snapshot'],additionalProperties:false};
