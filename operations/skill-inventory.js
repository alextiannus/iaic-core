import {createHash} from 'node:crypto';
import {ScopeCursor} from './cursor.js';
const fail=(message,statusCode=502)=>Object.assign(Error(message),{statusCode});
const text=(v,max=2000)=>typeof v==='string'&&v.length>0&&v.length<=max;
const states=['all','installed','not-installed','enabled','blocked','unknown','update-available','unregistered'];
async function bounded(port,input,ms){let timer;const controller=new AbortController();try{return await Promise.race([Promise.resolve().then(()=>port({...input,signal:controller.signal})),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(fail('Skill source timeout',504));},ms);})]);}finally{clearTimeout(timer);}}
function snapshot(value,kind,now){
 if(!value||!Array.isArray(value.items)||value.items.length>10000||typeof value.complete!=='boolean')throw fail('Invalid Skill snapshot');
 const at=Date.parse(value.observedAt),until=Date.parse(value.validUntil);
 if(!Number.isFinite(at)||!Number.isFinite(until)||at>now||until<at)throw fail('Invalid Skill snapshot time');
 const seen=new Set();
 const items=value.items.map(row=>{
  if(!row||!text(row.id)||seen.has(row.id))throw fail('Invalid or duplicate Skill identity');seen.add(row.id);
  if(kind==='catalog'){
   if(!text(row.name,500)||!text(row.description,2000)||!text(row.version,500))throw fail('Invalid Skill metadata');
   const result={id:row.id,name:row.name,description:row.description,version:row.version};
   for(const key of ['format','license','compatibility','allowed-tools','source'])if(row[key]!=null){if(!text(row[key],4000))throw fail('Invalid Skill metadata');result[key]=row[key];}
   // Display only public author/version metadata; arbitrary host metadata can contain secrets.
   if(row.metadata&&typeof row.metadata==='object'){result.metadata={};for(const key of ['author','version'])if(text(row.metadata[key],500))result.metadata[key]=row.metadata[key];}
   return result;
  }
  if(!text(row.installedVersion,500)||typeof row.enabled!=='boolean'||!['ready','blocked','unknown'].includes(row.readiness)||!text(row.reason))throw fail('Invalid Skill binding');
  return {id:row.id,installedVersion:row.installedVersion,enabled:row.enabled,readiness:row.readiness,reason:row.reason};
 });
 return {items,complete:value.complete&&until>now,state:until>now?'fresh':'stale',observedAt:value.observedAt,validUntil:value.validUntil};
}
/** Metadata-only operator projection. Host ports must filter by current scope before returning snapshots. */
export class SkillInventory {
 constructor({operations,listCatalog,readBindings,cursorKey,clock=()=>Date.now(),timeoutMs=2000}){
  if(!operations||['scope','unchanged','agent'].some(k=>typeof operations[k]!=='function')||typeof listCatalog!=='function'||typeof readBindings!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>30000)throw Error('SkillInventory requires Operations and scoped source ports');
  Object.assign(this,{operations,listCatalog,readBindings,clock,timeoutMs});this.cursors=new ScopeCursor(cursorKey);
 }
 async list(actor,input={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['agentId','query','status','limit','cursor'].includes(k)))throw fail('Invalid Skill query',400);
  const {agentId=null,query='',status='all',limit=20,cursor=null}=input;
  if(agentId!==null&&!text(agentId)||typeof query!=='string'||query.length>200||!states.includes(status)||!Number.isInteger(limit)||limit<1||limit>50||cursor!==null&&!text(cursor,4096)||!agentId&&status!=='all')throw fail('Invalid Skill query',400);
  const scope=await this.operations.scope(actor,'skills',agentId);
  const agent=agentId?(await this.operations.agent(actor,agentId)).agent:null;
  const context={actor,scope,agent};
  const [rawCatalog,rawBindings]=await Promise.all([bounded(this.listCatalog,context,this.timeoutMs),agent?bounded(this.readBindings,context,this.timeoutMs):null]);
  const now=this.clock(),catalog=snapshot(rawCatalog,'catalog',now),bindings=rawBindings?snapshot(rawBindings,'bindings',now):null;
  const byId=new Map(bindings?.items.map(r=>[r.id,r])??[]);
  const items=catalog.items.map(skill=>({...skill,registered:true}));
  const catalogIds=new Set(items.map(s=>s.id));
  for(const row of bindings?.items??[])if(!catalogIds.has(row.id))items.push({id:row.id,name:row.id,description:'已安装，但当前可见系统目录中没有该技能。',version:null,registered:catalog.complete?false:null});
  for(const row of items){
   const binding=byId.get(row.id);row.installed=binding?true:bindings?.complete?false:null;
   row.installedVersion=binding?.installedVersion??null;row.enabled=binding?.enabled??null;
   row.updateAvailable=binding&&row.version&&catalog.state==='fresh'&&bindings.state==='fresh'?row.version!==binding.installedVersion:null;
   row.readiness=binding&&bindings.state==='fresh'?binding.readiness:'unknown';
   row.reason=binding?.reason??(agent?'未安装或安装信息未完整上报':'选择 Agent 后检查安装与运行状态');
   if(binding&&!binding.enabled){row.readiness='blocked';row.reason='该 Agent 已停用此技能。'+row.reason;}
   if(binding&&(!row.registered||catalog.state!=='fresh'||bindings.state!=='fresh')){row.readiness='unknown';row.reason='目录或安装依据缺失 / 已过期；请刷新核实。';}
  }
  items.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const matches=row=>({all:true,installed:row.installed===true,'not-installed':row.installed===false,enabled:row.enabled===true,blocked:row.readiness==='blocked',unknown:row.readiness==='unknown','update-available':row.updateAvailable===true,unregistered:row.registered===false})[status];
  const normalized=query.trim().toLocaleLowerCase();
  const filtered=items.filter(r=>matches(r)&&[r.id,r.name,r.description,r.source??''].join(' ').toLocaleLowerCase().includes(normalized));
  // Bind continuations to the full authorized snapshot, query and Agent, not a mutable offset alone.
  const revision=createHash('sha256').update(JSON.stringify([items,catalog.state,catalog.complete,bindings?.state,bindings?.complete])).digest('hex');
  const binding=createHash('sha256').update(JSON.stringify([this.operations.namespace,scope,agentId,normalized,status,limit,revision])).digest('hex');
  const start=cursor?Number(this.cursors.open(cursor,binding)):0;
  if(!Number.isSafeInteger(start)||start<0||start>filtered.length)throw fail('Invalid Skill continuation',400);
  await this.operations.unchanged(actor,scope,'skills',agentId);
  const source=s=>s?{state:s.state,complete:s.complete,observedAt:s.observedAt,validUntil:s.validUntil}:null;
  return {schemaVersion:1,agentId,asOf:new Date(now).toISOString(),revision,complete:catalog.complete&&(!bindings||bindings.complete),sources:{catalog:source(catalog),bindings:source(bindings)},counts:{scope:'authorized-snapshot',supported:catalog.items.length,installed:bindings?.items.length??null,matched:filtered.length,blocked:agent?items.filter(x=>x.readiness==='blocked').length:null,updates:agent?items.filter(x=>x.updateAvailable).length:null},items:filtered.slice(start,start+limit),nextCursor:start+limit<filtered.length?this.cursors.seal(binding,String(start+limit)):null};
 }
}
