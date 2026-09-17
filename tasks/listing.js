import {taskDiagnostic} from './diagnostics.js';
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {defineCapability} from '../capabilities/index.js';
import {pageOptions,pagePosition,taskPageSchema} from './paging.js';
const invalid=()=>Object.assign(new Error('Invalid Task page or continuation cursor'),{statusCode:400});
const publicTask=task=>({id:task.id,capability:task.capability,status:task.status,waitingReason:task.waiting_reason??null,...(taskDiagnostic(task)?{diagnostic:taskDiagnostic(task)}:{})});
export class TaskListing{
 #key;
 constructor({store,readTask,resolveOwner,cursorKey,project=publicTask}){
  if(typeof store?.page!=='function'||typeof readTask!=='function'||typeof resolveOwner!=='function'||typeof project!=='function'||!(cursorKey instanceof Uint8Array)||cursorKey.byteLength!==32)throw new Error('Task listing requires page/current-read/owner ports and a persistent 32-byte cursor key');
  this.#key=Buffer.from(cursorKey);Object.assign(this,{store,readTask,resolveOwner,project});
 }
 seal(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.#key,iv);return Buffer.concat([iv,cipher.update(JSON.stringify(value),'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64url');}
 open(cursor){try{if(!/^[A-Za-z0-9_-]+$/.test(cursor))throw invalid();const bytes=Buffer.from(cursor,'base64url');if(bytes.length<29)throw invalid();const cipher=createDecipheriv('aes-256-gcm',this.#key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(-16));return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString('utf8'));}catch{throw invalid();}}
 async list(actor,input={}){
  const options=pageOptions(input),owner=await this.resolveOwner(actor);
  if(typeof owner!=='string'||!owner||owner.length>2000)throw new Error('Trusted Task listing owner required');
  const binding=createHash('sha256').update(JSON.stringify({owner,capability:options.capability,status:options.status})).digest('hex');
  let before=null;if(options.cursor){const saved=this.open(options.cursor);if(saved.version!==1||saved.binding!==binding)throw invalid();before=pagePosition(saved.before);}
  const page=await this.store.page(actor,{limit:options.limit,capability:options.capability,status:options.status,before}),items=[];
  if(!Array.isArray(page.items)||page.items.length>options.limit||typeof page.hasMore!=='boolean')throw new Error('Invalid bounded Task page');
  for(const candidate of page.items){
   let task;try{task=await this.readTask(actor,candidate.id);}catch(error){if([403,404].includes(error.statusCode))continue;throw error;}
   if(task.id!==candidate.id)throw new Error('Task read port returned a different Task');
   if(options.capability&&task.capability!==options.capability||options.status&&task.status!==options.status)continue;
   items.push(await this.project(task,{actor}));
  }
  if(await this.resolveOwner(actor)!==owner)throw Object.assign(new Error('Task listing scope changed'),{statusCode:403});
  if(page.hasMore&&!page.items.length)throw new Error('Task page did not advance');
  return {items,nextCursor:page.hasMore?this.seal({version:1,binding,before:pagePosition(page.items.at(-1))}):null};
 }
}
export function createTaskListCapability({listing,authorize,name='tasks.list'}){
 const execute=(input,{actor})=>listing.list(actor,input);
 return defineCapability({name,description:'List currently authorized Task states in bounded pages; continue even when a page is empty if nextCursor is present',input:taskPageSchema,output:{type:'object',properties:{items:{type:'array',items:{type:'object'}},nextCursor:{type:['string','null']}},required:['items','nextCursor'],additionalProperties:false},effect:'read',authorize,revalidate:(input,_result,context)=>execute(input,context),implementation:{kind:'function',execute}});
}
