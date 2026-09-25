import Ajv from 'ajv';
import {createHash} from 'node:crypto';
import {contracts,descriptor,roster,pageInput} from './contracts.js';
import {ScopeCursor} from './cursor.js';
const fail=(message,statusCode=400)=>Object.assign(Error(message),{statusCode});
const identifier=v=>{if(typeof v!=='string'||!v.trim()||v.length>2000)throw fail('Trusted operations scope or identifier required');return v;};
const ajv=new Ajv({strict:true});
const checks=Object.fromEntries(Object.entries({...contracts,descriptor,roster,pageInput}).map(([k,v])=>[k,ajv.compile(v)]));
const valid=(name,data)=>{if(!checks[name](data))throw fail('Invalid operations source contract',502);return structuredClone(data);};
function freshness(value,now){const at=Date.parse(value.observedAt),until=Date.parse(value.validUntil);if(!Number.isFinite(at)||!Number.isFinite(until)||until<at||at>now)return 'invalid';return until<=now?'stale':'fresh';}
async function bounded(port,input,timeoutMs){const controller=new AbortController();let timer;try{return await Promise.race([Promise.resolve().then(()=>port({...input,signal:controller.signal})),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(fail('Operations source timeout',504));},timeoutMs);})]);}finally{clearTimeout(timer);}}
export class Operations {
 constructor({namespace,cursorKey,resolveScope,authorize,listAgents,readAgent,sources,clock=()=>Date.now(),timeoutMs=2000}) {
  if([resolveScope,authorize,listAgents,readAgent,clock].some(p=>typeof p!=='function')||!sources||Object.keys(contracts).some(k=>typeof sources[k]!=='function'))throw Error('Operations requires explicit scope, current authorization, roster and four read-only source ports');
  if(!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>30000)throw Error('Invalid operations source timeout');
  Object.assign(this,{namespace:identifier(namespace),resolveScope,authorize,listAgents,readAgent,sources,clock,timeoutMs});this.cursors=new ScopeCursor(cursorKey);
 }
 async scope(actor,operation,id=null){const scope=identifier(await this.resolveScope(actor));if(await this.authorize(actor,{operation,id,scope})!==true)throw fail('Operations access denied',403);return scope;}
 async unchanged(actor,scope,operation,id=null){if(await this.scope(actor,operation,id)!==scope)throw fail('Operations visibility scope changed',403);}
 async agents(actor,input={}) {
  valid('pageInput',input);const {limit=20,cursor}=input,scope=await this.scope(actor,'agents');
  const binding=createHash('sha256').update(JSON.stringify([this.namespace,scope])).digest('hex');
  const page=valid('roster',await bounded(this.listAgents,{actor,scope,limit,after:cursor?this.cursors.open(cursor,binding):null},this.timeoutMs));
  if(page.items.length>limit||new Set(page.items.map(x=>x.id)).size!==page.items.length||page.next&&!page.items.length)throw fail('Invalid bounded operations roster',502);
  const items=[];
  for(const item of page.items)if(await this.authorize(actor,{operation:'agent',id:item.id,scope})===true)items.push(item);
  await this.unchanged(actor,scope,'agents');
  return {schemaVersion:1,asOf:new Date(this.clock()).toISOString(),items,nextCursor:page.next?this.cursors.seal(binding,page.next):null,complete:page.complete};
 }
 async agent(actor,id) {
  identifier(id);const scope=await this.scope(actor,'agent',id),agent=valid('descriptor',await bounded(this.readAgent,{actor,scope,id},this.timeoutMs));
  if(agent.id!==id)throw fail('Operations Agent identity mismatch',502);
  const entries=await Promise.all(Object.keys(contracts).map(async kind=>{
   try {const value=valid(kind,await bounded(this.sources[kind],{actor,scope,agent:structuredClone(agent)},this.timeoutMs));
    const identities=value.items.map(x=>kind==='models'?JSON.stringify([x.taskId,x.reference.source,x.reference.id,x.reference.revision]):x.id);
    if(new Set(identities).size!==identities.length)throw fail('Duplicate operations source record',502);
    return [kind,{value}];
   } catch(error) {if(error.statusCode===403||error.statusCode===404)throw fail('Operations source access unavailable',403);return [kind,{error:error.statusCode===504?'timeout':error.statusCode===502?'invalid-source':'source-unavailable'}];}
  }));
  const now=this.clock(),sources={},data={};
  for(const [kind,result] of entries){
   const value=result.value,state=value?freshness(value,now):result.error;
   sources[kind]={state,complete:value?.complete===true&&state==='fresh',reference:value?.reference??null,observedAt:value?.observedAt??null,validUntil:value?.validUntil??null};
   data[kind]=value&&state!=='invalid'?value.items:[];
  }
  const signals=data.signals.map(s=>({...s,freshness:freshness(s,now)}));data.signals=signals;
  const usable=sources.signals.state==='fresh'?signals.filter(s=>s.freshness==='fresh'&&s.basis!=='reported'):[];
  const coverage=sources.signals.complete&&signals.length>0&&usable.length===signals.length;
  const health=usable.some(s=>s.state==='unavailable')?'unavailable':usable.some(s=>s.state==='degraded')?'degraded':coverage&&usable.every(s=>s.state==='healthy')?'healthy':'unknown';
  const counts={queued:0,running:0,waiting:0,succeeded:0,failed:0,cancelled:0,unknownResults:0};for(const task of data.tasks){counts[task.status]++;if(task.resultState==='unknown')counts.unknownResults++;}
  const activity=!sources.tasks.complete?'unknown':counts.running?'working':counts.waiting?'waiting':counts.queued?'queued':'idle';
  const result={schemaVersion:1,asOf:new Date(now).toISOString(),agent,activity,taskCounts:counts,health:{state:health,complete:coverage,reasons:[...new Set([...usable.filter(s=>s.state!=='healthy').map(s=>s.reason),...(!coverage?['incomplete-current-signal-coverage']:[])])]},sources,...data};
  await this.unchanged(actor,scope,'agent',id);return result;
 }
 async overview(actor,input={}) {
  const scope=await this.scope(actor,'overview'),page=await this.agents(actor,input),items=[],removed=[];let offset=0;
  const worker=async()=>{for(;;){const index=offset++;if(index>=page.items.length)return;const id=page.items[index].id;try{const detail=await this.agent(actor,id);items[index]={agent:detail.agent,activity:detail.activity,taskCounts:detail.taskCounts,health:detail.health,asOf:detail.asOf,complete:Object.values(detail.sources).every(s=>s.complete)};}catch{removed.push(index);continue;}}};
  await Promise.all(Array.from({length:Math.min(4,page.items.length)},worker));
  await this.unchanged(actor,scope,'overview');const visible=items.filter(Boolean);
  return {schemaVersion:1,asOf:new Date(this.clock()).toISOString(),items:visible,nextCursor:page.nextCursor,complete:page.complete&&removed.length===0&&visible.every(x=>x.complete),count:{scope:'returned-page',agents:visible.length,healthUnknown:visible.filter(x=>x.health.state==='unknown').length}};
 }
}
