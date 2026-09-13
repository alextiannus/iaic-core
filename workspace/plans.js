import {defineCapability} from '../capabilities/index.js';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const idSchema={type:'string',pattern:'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'};
const stepsSchema={type:'array',maxItems:20,items:{type:'object',properties:{id:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,60}$'},description:{type:'string',minLength:1,maxLength:500},status:{type:'string',enum:['pending','in_progress','done','blocked']},note:{type:'string',maxLength:2000}},required:['id','description','status'],additionalProperties:false}};
function taskId(value){if(typeof value!=='string'||!new RegExp(idSchema.pattern).test(value))throw fail('Task UUID required');return value.toLowerCase();}
function steps(value){
 if(!Array.isArray(value)||value.length>20)throw fail('Plan requires at most 20 steps');
 const names=new Set();
 for(const step of value){
  if(!step||Object.getPrototypeOf(step)!==Object.prototype||Object.keys(step).some(k=>!['id','description','status','note'].includes(k))||typeof step.id!=='string'||!/^[a-zA-Z0-9_-]{1,60}$/.test(step.id)||names.has(step.id)||typeof step.description!=='string'||!step.description.trim()||step.description.length>500||!['pending','in_progress','done','blocked'].includes(step.status)||(step.note!==undefined&&(typeof step.note!=='string'||step.note.length>2000)))throw fail('Invalid or duplicate plan step');
  names.add(step.id);
 }
 if(Buffer.byteLength(JSON.stringify(value))>16000)throw fail('Plan exceeds 16000 bytes');
 return structuredClone(value);
}

// A plan is editable working material, never an outcome verdict or authority.
// Persistence, CAS and source attribution remain owned by the Workspace port.
export class TaskPlans {
 constructor({workspace,readTask}){
  if(['read','write'].some(name=>typeof workspace?.[name]!=='function')||typeof readTask!=='function')throw new Error('Task plans require Workspace and current-authorized Task read ports');
  this.workspace=workspace;this.readTask=readTask;
 }
 async check(actor,id,{writing=false,taskId:executingTask}={}){
  id=taskId(id);
  if(executingTask!==undefined&&taskId(executingTask)!==id)throw fail('A running Task may only access its own plan',403);
  const task=await this.readTask(actor,id);
  if(!task||taskId(task.id)!==id)throw fail('Task plan access denied',403);
  if(writing&&!['queued','running','waiting'].includes(task.status))throw fail('Terminal Task plans cannot be updated',409);
  return {id,path:'plans/tasks/'+id+'.json'};
 }
 async read(actor,{id},context={}){
  const binding=await this.check(actor,id,context);let document;
  try{document=await this.workspace.read(actor,{path:binding.path});}catch(error){if(error.statusCode!==404)throw error;return {taskId:binding.id,revision:0,steps:[],reference:null};}
  let plan;try{plan=JSON.parse(document.content);}catch{throw fail('Stored Task plan is invalid',409);}
  if(plan?.format!=='iaic.task-plan.v1'||plan.taskId!==binding.id)throw fail('Stored Task plan binding is invalid',409);
  return {taskId:binding.id,revision:document.reference.revision,steps:steps(plan.steps),reference:document.reference};
 }
 async preflight(actor,input,context={}){
  const binding=await this.check(actor,input.id,{...context,writing:true});steps(input.steps);
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||input.expectedRevision>2147483645)throw fail('Current plan revision required');
  return typeof this.workspace.preflightWrite==='function'?this.workspace.preflightWrite(actor,{path:binding.path,expectedRevision:input.expectedRevision}):(await this.read(actor,input,context)).revision===input.expectedRevision;
 }
 async update(actor,input,context={}){
  const proposed=steps(input.steps);
  if(await this.preflight(actor,input,context)!==true)throw fail('Task plan changed; read its current revision',409);
  const binding=await this.check(actor,input.id,{...context,writing:true});
  const saved=await this.workspace.write(actor,{path:binding.path,expectedRevision:input.expectedRevision,mediaType:'application/json',content:JSON.stringify({format:'iaic.task-plan.v1',taskId:binding.id,steps:proposed})},context);
  return {taskId:binding.id,revision:saved.reference.revision,reference:saved.reference};
 }
}

export function createTaskPlanCapabilities({plans,authorize,namespace='tasks.plan'}){
 const base={type:'object',properties:{id:idSchema},required:['id'],additionalProperties:false};
 const read=(input,context)=>plans.read(context.actor,input,context);
 return [
  defineCapability({name:namespace+'.read',description:'Read the current Task working plan. Step status is a planning claim, not verified completion.',input:base,output:{type:'object'},effect:'read',authorize,revalidate:(input,_result,context)=>read(input,context),implementation:{kind:'function',execute:read}}),
  defineCapability({name:namespace+'.update',description:'Replace the Task working plan using its current revision (0 creates). Keep useful progress and revise steps as needed. Done is a planning claim; finish still requires application verification.',input:{...base,properties:{...base.properties,expectedRevision:{type:'integer',minimum:0,maximum:2147483645},steps:stepsSchema},required:['id','expectedRevision','steps']},output:{type:'object'},effect:'write',retry:'never-replay',authorize,
   preflight:(input,context)=>plans.preflight(context.actor,input,context),projectHistoryInput:({id,expectedRevision})=>({id,expectedRevision}),
   revalidate:async(input,result,context)=>{await read(input,context);return result;},
   implementation:{kind:'function',execute:(input,context)=>plans.update(context.actor,input,context)}})
 ];
}
