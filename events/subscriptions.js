import fs from 'node:fs/promises';import {defineCapability} from '../capabilities/index.js';import {eventCursor,eventPrefix} from './cursor.js';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const key=v=>{if(typeof v!=='string'||!v.trim()||v.length>200)throw fail('Bounded subscription key required');return v;};
const scope=s=>[s?.applicationId,s?.assistantId,s?.subjectId].map(key);
const view=r=>({key:r.subscription_key,prefix:r.prefix,cursor:String(r.cursor)});
export class PostgresEventSubscriptions {
 constructor({pool}){this.pool=pool;}
 async initialize(){await this.pool.query(await fs.readFile(new URL('./subscriptions-schema.sql',import.meta.url),'utf8'));}
 async subscribe(owner,{key:id,prefix=''}){
  key(id);eventPrefix(prefix);const args=[...scope(owner),id,prefix];
  const r=await this.pool.query('INSERT INTO iaic_event_subscriptions(application_id,assistant_id,subject_id,subscription_key,prefix) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING *',args);
  const row=r.rows[0]??(await this.pool.query('SELECT * FROM iaic_event_subscriptions WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND subscription_key=$4',args.slice(0,4))).rows[0];
  if(!row||row.prefix!==prefix)throw fail('Subscription key belongs to another prefix',409);return view(row);
 }
 async read(owner,{key:id}){const row=(await this.pool.query('SELECT * FROM iaic_event_subscriptions WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND subscription_key=$4',[...scope(owner),key(id)])).rows[0];if(!row)throw fail('Subscription not found',404);return view(row);}
 async advance(owner,{key:id,expectedCursor,cursor}){
  eventCursor(expectedCursor);eventCursor(cursor);if(BigInt(cursor)<BigInt(expectedCursor))throw fail('Event checkpoint cannot move backwards');
  const args=[...scope(owner),key(id),expectedCursor,cursor];
  const row=(await this.pool.query('UPDATE iaic_event_subscriptions SET cursor=$6::bigint WHERE application_id=$1 AND assistant_id=$2 AND subject_id=$3 AND subscription_key=$4 AND cursor=$5::bigint RETURNING *',args)).rows[0];
  if(row)return {key:id,acknowledgedThrough:cursor};
  const current=await this.read(owner,{key:id});if(BigInt(current.cursor)>=BigInt(cursor))return {key:id,acknowledgedThrough:cursor};
  throw fail('Subscription checkpoint changed; read current progress',409);
 }
}
export class EventSubscriptions {
 constructor({store,events,resolveScope,authorize}){if(!store||typeof events?.list!=='function'||typeof resolveScope!=='function'||typeof authorize!=='function')throw fail('Subscription store, event feed and current authority ports required');Object.assign(this,{store,events,resolveScope,authorize});}
 async owner(actor,operation,input){if(await this.authorize(actor,{...input,operation})!==true)throw fail('Subscription access denied',403);const owner=await this.resolveScope(actor);scope(owner);return owner;}
 async checked(actor,operation,input,owner,result){const current=await this.owner(actor,operation,input);if(JSON.stringify(scope(current))!==JSON.stringify(scope(owner)))throw fail('Subscription scope changed',403);return result;}
 async subscribe(actor,input){const owner=await this.owner(actor,'subscribe',input);return this.checked(actor,'subscribe',input,owner,await this.store.subscribe(owner,input));}
 async status(actor,{key:id}){const input={key:id},owner=await this.owner(actor,'read',input);return this.checked(actor,'read',input,owner,await this.store.read(owner,input));}
 async read(actor,{key:id,limit=50}){const input={key:id,limit},owner=await this.owner(actor,'read',input),subscription=await this.store.read(owner,{key:id}),page=await this.events.list(owner,{after:subscription.cursor,prefix:subscription.prefix,limit});return this.checked(actor,'read',input,owner,{...subscription,...page});}
 async acknowledge(actor,{key:id,expectedCursor,cursor}){
  eventCursor(expectedCursor);eventCursor(cursor);const input={key:id,expectedCursor,cursor},owner=await this.owner(actor,'acknowledge',input),subscription=await this.store.read(owner,{key:id});
  if(BigInt(cursor)<BigInt(expectedCursor))throw fail('Event checkpoint cannot move backwards');
  if(cursor!==expectedCursor){const page=await this.events.list(owner,{after:expectedCursor,prefix:subscription.prefix,limit:100});if(!page.items.some(e=>e.sequence===cursor))throw fail('Acknowledge only a cursor from a bounded matching event page',409);}
  await this.checked(actor,'acknowledge',input,owner,null);
  return this.store.advance(owner,input);
 }
}
export function createEventSubscriptionCapabilities({subscriptions}){
 const k={type:'string',minLength:1,maxLength:200},c={type:'string',pattern:'^(0|[1-9][0-9]{0,18})$'};
 return [
  ['subscribe',{key:k,prefix:{type:'string',maxLength:200}},['key'],'write','idempotent'],
  ['read',{key:k,limit:{type:'integer',minimum:1,maximum:100}},['key'],'read'],
  ['acknowledge',{key:k,expectedCursor:c,cursor:c},['key','expectedCursor','cursor'],'write','idempotent']
 ].map(([operation,properties,required,effect,retry])=>defineCapability({name:'events.subscription.'+operation,description:operation+' a scoped event subscription. A checkpoint acknowledges consumption, not successful business processing or new authority.',input:{type:'object',properties,required,additionalProperties:false},output:{type:'object'},effect,...(retry?{retry}:{}),authorize:async()=>true,implementation:{kind:'function',execute:(input,{actor})=>subscriptions[operation](actor,input)},revalidate:async(input,_r,{actor})=>{if(operation==='read')return subscriptions.read(actor,input);const current=await subscriptions.status(actor,{key:input.key});if(operation==='subscribe'){if(current.prefix!==(input.prefix??''))throw fail('Subscription prefix changed',409);return current;}if(BigInt(current.cursor)<BigInt(input.cursor))throw fail('Acknowledgement is not currently confirmed',409);return {key:input.key,acknowledgedThrough:input.cursor};}}));
}
