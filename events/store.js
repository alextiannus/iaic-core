import fs from 'node:fs/promises';import {randomUUID,createHash} from 'node:crypto';import {isDeepStrictEqual} from 'node:util';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const text=v=>typeof v==='string'&&v.trim()&&v.length<=200;
const identity=s=>{const v=[s?.applicationId,s?.assistantId,s?.subjectId];if(!v.every(text))throw fail('Trusted event scope required',401);return v;};
function object(value,limit){let encoded;try{encoded=JSON.stringify(value);}catch{throw fail('Event documents must be JSON objects');}if(!encoded)throw fail('Event documents must be JSON objects');if(Buffer.byteLength(encoded)>limit)throw fail('Event document exceeds limit',413);const result=JSON.parse(encoded);if(!result||typeof result!=='object'||Array.isArray(result))throw fail('Event documents must be JSON objects');return result;}
function ordered(value,depth=0){if(depth>30)throw fail('Event document is too deeply nested');if(Array.isArray(value))return value.map(v=>ordered(v,depth+1));if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k],depth+1)]));return value;}
export const eventDigest=(data,source)=>createHash('sha256').update(JSON.stringify(ordered({data,source}))).digest('hex');
const view=r=>({id:r.id,key:r.event_key,data:r.data,source:r.source,digest:r.digest,publishedAt:r.published_at});
export class EventStore {
 constructor({pool}){this.pool=pool;}
 async initialize(){await this.pool.query(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));}
 async publish(scope,{key,data,source}){
  const account=identity(scope);if(!text(key))throw fail('Event key required');data=object(data,8000);source=object(source,4000);
  if(typeof source.kind!=='string'||!source.kind.trim())throw fail('Trusted event source required');
  const digest=eventDigest(data,source);
  const result=await this.pool.query('INSERT INTO iaic_events(id,application_id,assistant_id,subject_id,event_key,data,source,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(application_id,assistant_id,subject_id,event_key) DO NOTHING RETURNING *',[randomUUID(),...account,key,data,source,digest]);
  // A separate statement observes the winner after a concurrent INSERT waits.
  const row=result.rows[0]||(await this.pool.query('SELECT * FROM iaic_events WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND event_key=$4',[...account,key])).rows[0];
  if(!row||eventDigest(row.data,row.source)!==row.digest||!isDeepStrictEqual(row.data,data))throw fail('Event key belongs to different data',409);return view(row);
 }
 async read(scope,{key}){if(!text(key))throw fail('Event key required');const row=(await this.pool.query('SELECT * FROM iaic_events WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND event_key=$4',[...identity(scope),key])).rows[0];if(!row)throw fail('Event not found',404);if(eventDigest(row.data,row.source)!==row.digest)throw fail('Event data no longer matches its receipt',409);return view(row);}
}
export class AssistantEvents {
 constructor({store,resolveScope,sourceFor,reservedPrefixes=[]}){if(!Array.isArray(reservedPrefixes)||reservedPrefixes.some(p=>typeof p!=='string'||!p||p.length>200))throw fail('Valid reserved event prefixes required');Object.assign(this,{store,resolveScope,sourceFor});this.reservedPrefixes=[...reservedPrefixes];}
 async authorize(actor){await this.resolveScope(actor);return true;}
 async publish(actor,{key,data}){if(typeof key==='string'&&this.reservedPrefixes.some(p=>key.startsWith(p)))throw fail('Event key prefix is reserved for trusted ingress',403);return this.store.publish(await this.resolveScope(actor),{key,data,source:await this.sourceFor(actor)});}
 async read(actor,{key}){return this.store.read(await this.resolveScope(actor),{key});}
}
