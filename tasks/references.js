import {defineCapability} from '../capabilities/index.js';
// A small current view, not a copy of task transcripts or generated summaries.
export function createTaskReferenceCapability({readTask,readArtifact,authorize}){
 const execute=async({taskId},{actor})=>{
  const task=await readTask(actor,taskId),artifacts=[];
  for(const ref of task.result?.artifacts??[]){try{await readArtifact(actor,ref);artifacts.push(ref);}catch(e){if(![403,404,409].includes(e.statusCode))throw e;}}
  return {id:task.id,status:task.status,goal:task.input.goal,error:task.error||'',artifacts,updatedAt:new Date(task.updated_at).toISOString()};
 };
 return defineCapability({name:'my_read_agent_task',description:'Read a currently authorized Agent Task status, original goal and still-accessible artifact references. Use sourceTaskId from the current goal when continuing work. This is execution evidence, not proof of general content correctness.',input:{type:'object',properties:{taskId:{type:'string',pattern:'^[0-9a-fA-F-]{36}$'}},required:['taskId'],additionalProperties:false},output:{type:'object',properties:{id:{type:'string'},status:{type:'string'},goal:{type:'string'},error:{type:'string'},artifacts:{type:'array',items:{type:'object'}},updatedAt:{type:'string'}},required:['id','status','goal','error','artifacts','updatedAt'],additionalProperties:false},effect:'read',authorize,revalidate:(input,_r,context)=>execute(input,context),implementation:{kind:'function',execute}});
}
