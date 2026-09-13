import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {evidenceDigest} from '../evaluation/runner.js';
const fail=message=>new Error(message);
// Local deployment port; command/configuration are trusted host code, not model output.
export class DockerDeployment {
 constructor({namespace,image,command,containerPort,healthPath='/health',environment=()=>({}),dockerPath='docker',user='65534:65534',memoryMiB=256,cpus=1,pids=128,timeoutMs=30000}){
  if(typeof namespace!=='string'||!namespace||namespace.length>100||typeof image!=='string'||!/(?:@|^)sha256:[a-f0-9]{64}$/.test(image)||!Array.isArray(command)||!command.length||command.some(v=>typeof v!=='string'||!v||v.includes('\0'))||!Number.isInteger(containerPort)||containerPort<1024||containerPort>65535||typeof healthPath!=='string'||!/^\/(?!\/)[^\s#]*$/.test(healthPath)||healthPath.length>500||typeof environment!=='function'||!/^0*[1-9]\d*(?::\d+)?$/.test(user)||!Number.isInteger(memoryMiB)||memoryMiB<16||!Number.isFinite(cpus)||cpus<=0||!Number.isInteger(pids)||pids<1||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw fail('Explicit immutable deployment image, host command, health endpoint and resource limits required');
  Object.assign(this,{namespace,image,command:[...command],containerPort,healthPath,environment,dockerPath,user,memoryMiB,cpus,pids,timeoutMs});
  this.digest=evidenceDigest({namespace,image,command,containerPort,healthPath,user,memoryMiB,cpus,pids});
 }
 name(requestKey){if(typeof requestKey!=='string'||!requestKey.trim()||requestKey.length>500)throw fail('Stable deployment request key required');return 'iaic-deployment-'+createHash('sha256').update(JSON.stringify([this.namespace,requestKey])).digest('hex');}
 async run(args,{stdin='',signal}={}){
  signal?.throwIfAborted();return new Promise(resolve=>{
   const child=execFile(this.dockerPath,args,{timeout:this.timeoutMs,maxBuffer:1048576,encoding:'utf8',signal},(error,stdout)=>resolve({ok:!error,stdout,error}));
   child.stdin.on('error',()=>{});child.stdin.end(stdin);
  });
 }
 unknown(requestKey){return Object.assign(fail('Deployment outcome is unconfirmed; inspect the original request key before any further action'),{outcomeUnknown:true,requestKey});}
 async raw(requestKey){
  const name=this.name(requestKey),r=await this.run(['container','ls','--all','--filter','name=^/'+name+'$','--format','{{.ID}}']);
  if(!r.ok)throw this.unknown(requestKey);if(!r.stdout.trim())return null;
  const inspected=await this.run(['inspect',name]);if(!inspected.ok)throw this.unknown(requestKey);
  let c;try{c=JSON.parse(inspected.stdout)[0];}catch{throw this.unknown(requestKey);}
  if(c?.Name!=='/'+name||c.Config?.Labels?.['io.iaic.deployment']!==this.digest||c.Config?.Image!==this.image)throw fail('Deployment request key is bound to another configuration');
  return c;
 }
 async inspect(requestKey){
  const c=await this.raw(requestKey);if(!c)return {requestKey,status:'absent',endpoint:null};
  const ports=c.NetworkSettings?.Ports?.[this.containerPort+'/tcp']??[];
  if(ports.some(p=>p.HostIp!=='127.0.0.1'))throw fail('Deployment endpoint binding changed');
  const endpoint=c.State?.Running&&ports.length===1?'http://127.0.0.1:'+ports[0].HostPort:null;
  let ready=false;
  if(endpoint)try{const response=await fetch(endpoint+this.healthPath,{signal:AbortSignal.timeout(2000),redirect:'error'});ready=response.status===200;await response.body?.cancel();}catch{}
  return {requestKey,containerId:c.Id,image:this.image,status:c.State?.Running?(ready?'ready':'starting'):c.State?.Status==='created'?'prepared':c.State?.Status==='exited'?'stopped':'unknown',endpoint,ready,exitCode:c.State?.Status==='exited'?c.State.ExitCode:null};
 }
 async deploy(requestKey,{signal}={}){
  const name=this.name(requestKey),env=await this.environment();
  if(!env||Object.getPrototypeOf(env)!==Object.prototype||Object.keys(env).length>100||Object.entries(env).some(([k,v])=>! /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)||typeof v!=='string'||/[\r\n\0]/.test(v))||Buffer.byteLength(JSON.stringify(env))>65536)throw fail('Deployment environment must be bounded single-line string values');
  const prior=await this.raw(requestKey);
  if(prior){const actual=new Map((prior.Config.Env??[]).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));if(Object.entries(env).some(([k,v])=>actual.get(k)!==v)||prior.Config.Labels['io.iaic.environment-keys']!==JSON.stringify(Object.keys(env).sort()))throw fail('Deployment environment changed; use a new request key');return this.inspect(requestKey);}
  const args=['create','--name',name,'--pull','never','--label','io.iaic.deployment='+this.digest,'--label','io.iaic.environment-keys='+JSON.stringify(Object.keys(env).sort()),'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit',String(this.pids),'--memory',this.memoryMiB+'m','--memory-swap',this.memoryMiB+'m','--cpus',String(this.cpus),'--user',this.user,'--tmpfs','/tmp:rw,noexec,nosuid,size=16777216','--publish','127.0.0.1::'+this.containerPort,'--env-file','/dev/stdin','--entrypoint',this.command[0],this.image,...this.command.slice(1)];
  const created=await this.run(args,{stdin:Object.entries(env).map(([k,v])=>k+'='+v).join('\n')+'\n',signal});
  if(!created.ok)throw this.unknown(requestKey);
  const c=await this.raw(requestKey);if(!c||c.State?.Status!=='created')throw this.unknown(requestKey);
  // Only this confirmed create starts the workload. Repeated deploy never restarts it.
  const started=await this.run(['start',c.Id],{signal});if(!started.ok)throw this.unknown(requestKey);
  return this.inspect(requestKey);
 }
 async stop(requestKey){const c=await this.raw(requestKey);if(!c)return {requestKey,status:'absent',endpoint:null};if(c.State?.Running){const stopped=await this.run(['stop','--time','10',c.Id]);if(!stopped.ok)throw this.unknown(requestKey);}return this.inspect(requestKey);}
}
