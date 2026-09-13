import fs from 'node:fs/promises';
import {defineCapability} from '../capabilities/index.js';
export class ReleasedCode{
 constructor({resources,sandbox,parentDirectory,authorize}){if(typeof resources?.materialize!=='function'||typeof sandbox?.execute!=='function'||typeof authorize!=='function')throw new Error('Released code requires resource loader, sandbox and authorization ports');Object.assign(this,{resources,sandbox,parentDirectory,authorize});}
 async run(actor,{release,input},{signal}={}){
  if(await this.authorize(actor,{release,input})!==true)throw Object.assign(new Error('Code execution denied'),{statusCode:403});
  const loaded=await this.resources.materialize(actor,release,{parentDirectory:this.parentDirectory});
  let result;
  try{result=await this.sandbox.execute({directory:loaded.directory,stdin:JSON.stringify(input),signal});return {...result,releaseId:loaded.releaseId,manifestDigest:loaded.manifestDigest,...(!result.cleanupConfirmed?{resourceDirectory:loaded.directory}:{})};}
  catch(error){error.resourceDirectory=loaded.directory;throw error;}
  finally{if(result?.cleanupConfirmed)await fs.rm(loaded.directory,{recursive:true,force:true});}
 }
}
export function createCodeExecutionCapability({execution,name='code.run'}){
 return defineCapability({name,description:'Execute authorized pinned release resources in the configured sandbox. Returns bounded stdout/stderr, exit status and cleanup evidence; execution success is not business outcome verification.',input:{type:'object',properties:{release:{type:'object',properties:{releaseId:{type:'string',minLength:1},manifestDigest:{type:'string',pattern:'^[a-f0-9]{64}$'}},required:['releaseId','manifestDigest'],additionalProperties:false},input:{}},required:['release','input'],additionalProperties:false},output:{type:'object',properties:{status:{type:'string'},cleanupConfirmed:{type:'boolean'},releaseId:{type:'string'},manifestDigest:{type:'string'}},required:['status','cleanupConfirmed','releaseId','manifestDigest']},effect:'write',retry:'never-replay',authorize:async()=>true,implementation:{kind:'function',execute:(input,context)=>execution.run(context.actor,input,{signal:context.signal})}});
}
