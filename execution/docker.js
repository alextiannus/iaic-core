import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const fail=message=>new Error(message);
function command(binary,args,{stdin='',signal,timeoutMs,maxOutputBytes}={}){
 return new Promise(resolve=>{
  const child=spawn(binary,args,{stdio:['pipe','pipe','pipe'],shell:false});let output=0,reason=null,stdout=[],stderr=[];
  const stop=value=>{if(!reason){reason=value;child.kill('SIGKILL');}};
  const capture=target=>chunk=>{const room=Math.max(0,maxOutputBytes-output);if(room)target.push(chunk.subarray(0,room));output+=chunk.length;if(output>maxOutputBytes)stop('output_limit');};
  child.stdout.on('data',capture(stdout));child.stderr.on('data',capture(stderr));child.stdin.on('error',()=>{});
  const abort=()=>stop('cancelled'),timer=setTimeout(()=>stop('timed_out'),timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  child.once('error',error=>{reason='spawn_error';stderr.push(Buffer.from(error.message).subarray(0,maxOutputBytes));});
  child.once('close',(exitCode,exitSignal)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve({exitCode,exitSignal,reason,stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')});});
  child.stdin.end(stdin);
 });
}
export class DockerSandbox{
 constructor({image,command:entrypoint,dockerPath='docker',user=`${process.getuid?.()??65534}:${process.getgid?.()??65534}`,timeoutMs=30000,maxOutputBytes=1048576,memoryMiB=128,cpus=1,pids=64,onStart=async()=>{}}){
  if(typeof image!=='string'||!/(?:@|^)sha256:[a-f0-9]{64}$/.test(image)||!Array.isArray(entrypoint)||!entrypoint.length||entrypoint.some(v=>typeof v!=='string'||!v)||!/^0*[1-9]\d*(?::\d+)?$/.test(user))throw fail('Sandbox requires an immutable image, fixed command and non-root numeric user');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000||!Number.isInteger(maxOutputBytes)||maxOutputBytes<1||!Number.isInteger(memoryMiB)||memoryMiB<16||!Number.isFinite(cpus)||cpus<=0||!Number.isInteger(pids)||pids<1||typeof onStart!=='function')throw fail('Invalid sandbox resource limits');
  Object.assign(this,{image,entrypoint:[...entrypoint],dockerPath,user,timeoutMs,maxOutputBytes,memoryMiB,cpus,pids,onStart});
 }
 async execute({directory,stdin='',signal}){
  if(typeof stdin!=='string'||Buffer.byteLength(stdin)>1048576)throw fail('Sandbox stdin must be text within 1 MiB');
  const source=await fs.realpath(directory);if(source.includes(',')||source.includes('\n'))throw fail('Sandbox mount path cannot contain comma or newline');
  const name='iaic-sandbox-'+randomUUID(),started=Date.now();
  const args=['run','--name',name,'--pull','never','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit',String(this.pids),'--memory',this.memoryMiB+'m','--memory-swap',this.memoryMiB+'m','--cpus',String(this.cpus),'--user',this.user,'--tmpfs','/tmp:rw,noexec,nosuid,size=16777216','--mount',`type=bind,source=${source},target=/work,readonly`,'--workdir','/work','-i','--entrypoint',this.entrypoint[0],this.image,...this.entrypoint.slice(1)];
  if(signal?.aborted)return {status:'cancelled',reason:'cancelled',stdout:'',stderr:'',exitCode:null,cleanupConfirmed:true,containerName:null,image:this.image,durationMs:0};
  await this.onStart({containerName:name,image:this.image,directory:source});
  let result;
  try{result=await command(this.dockerPath,args,{stdin,signal,timeoutMs:this.timeoutMs,maxOutputBytes:this.maxOutputBytes});}
  finally{
   const cleanup=await command(this.dockerPath,['rm','-f',name],{timeoutMs:10000,maxOutputBytes:8000});
   const confirmed=cleanup.exitCode===0||(!result?.reason&&!cleanup.reason&&cleanup.stderr.includes('No such container')&&cleanup.stderr.includes(name));
   if(result)Object.assign(result,{cleanupConfirmed:confirmed,containerName:name,image:this.image,durationMs:Date.now()-started});
  }
  return {...result,status:!result.cleanupConfirmed?'unknown':result.reason??(result.exitCode===0?'succeeded':'failed')};
 }
}
