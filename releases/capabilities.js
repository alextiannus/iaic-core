import {defineCapability} from '../capabilities/index.js';
const key={type:'string',minLength:1,maxLength:500},revision={type:'integer',minimum:0,maximum:2147483646};
const object=(properties,required)=>({type:'object',properties,required,additionalProperties:false});
export function createReleaseCapabilities({releases,prefix='releases'}){
 const versions=object(Object.fromEntries(['prompt','model','skills','tools','knowledge','harness'].map(name=>[name,key])),['prompt','model','skills','tools','knowledge','harness']);
 const definitions=[
  ['register',object({manifest:{type:'object',properties:{id:key,implementationRevision:key,versions},required:['id','implementationRevision','versions'],additionalProperties:true},evaluations:object({capability:key,regression:key},['capability','regression'])},['manifest','evaluations']),(a,i)=>releases.register(a,i),'Register an immutable candidate after frozen capability/regression evidence checks. Does not deploy code.','idempotent'],
  ['configure',object({name:key,stableId:key,canaryId:{type:['string','null']},percentage:{type:'integer',minimum:0,maximum:100},expectedRevision:revision},['name','stableId','expectedRevision']),(a,i)=>releases.setChannel(a,i),'Configure stable/canary selection with an expected channel revision. Set a prior enabled stable release to roll back selection. Does not deploy binaries.','never-replay'],
  ['stop',object({id:key},['id']),(a,i)=>releases.stop(a,i.id),'Stop a release for future resolution and pinned-reference checks. Existing effects are not undone.','never-replay'],
  ['resolve',object({name:key},['name']),(a,i)=>releases.resolve(a,i.name),'Resolve the current release using a host-derived stable cohort.'],
  ['check',object({releaseId:key,manifestDigest:{type:'string',pattern:'^[a-f0-9]{64}$'}},['releaseId','manifestDigest']),(a,i)=>releases.check(a,i),'Check that a pinned release is still enabled and its immutable manifest matches.'],
  ['channel',object({name:key},['name']),(a,i)=>releases.channel(a,i.name),'Read current stable/canary channel settings and revision.'],
  ['history',object({after:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}},[]),(a,i)=>releases.history(a,i),'Read scoped release management decisions and actor references.']
 ];
 return definitions.map(([name,input,run,description,retry])=>{const execute=(value,{actor})=>run(actor,value);return defineCapability({name:prefix+'.'+name,description,input,output:name==='history'?{type:'array',items:{type:'object'}}:{type:['object','null']},effect:retry?'write':'read',...(retry?{retry}:{revalidate:(value,_old,context)=>execute(value,context)}),authorize:async()=>true,implementation:{kind:'function',execute}});});
}
