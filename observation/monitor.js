import {defineCapability} from '../capabilities/index.js';
import {fail,key} from '../releases/store.js';
import {jsonValue} from '../evaluation/runner.js';

// A normal Task capability or host-worker operation, not a second scheduler or Runtime.
export class ReleaseMonitor {
 #protect;
 constructor({observation,resolveTarget,authorize,autoProtect=false}){
  if(typeof observation?.collect!=='function'||typeof observation?.protect!=='function'||typeof resolveTarget!=='function'||typeof authorize!=='function'||typeof autoProtect!=='boolean')throw fail('Monitor requires observation, trusted target and current authorization ports');
  Object.assign(this,{observation,resolveTarget,authorize});this.#protect=autoProtect;
 }
 async run(actor,{channel}){
  key(channel);if(await this.authorize(actor,{action:'monitor',channel})!==true)throw fail('Release monitoring denied',403);
  const selected=jsonValue(await this.resolveTarget(actor,{channel}));
  const target={releaseId:selected?.releaseId,manifestDigest:selected?.manifestDigest,expectedRevision:selected?.expectedRevision};
  if(!target||!Number.isInteger(target.expectedRevision)||target.expectedRevision<1||target.expectedRevision>2147483646||!/^[a-f0-9]{64}$/.test(target.manifestDigest||''))throw fail('Trusted current release and channel revision required',409);
  key(target.releaseId);
  const collected=await this.observation.collect(actor,{channel,releaseId:target.releaseId,manifestDigest:target.manifestDigest});
  let protection=null;
  if(this.#protect&&collected.assessment?.shouldStop){
   if(await this.authorize(actor,{action:'protect',channel})!==true)throw fail('Automatic release protection denied',403);
   protection=await this.observation.protect(actor,{assessmentId:collected.assessment.id,expectedRevision:target.expectedRevision});
  }
  return {channel,target,...collected,protection};
 }
}
export function createReleaseMonitorCapability({monitor,name='observation.monitor'}){
 return defineCapability({name,description:'Collect trusted evidence and assess a host-selected release. Only host configuration and current policy may enable protective rollback.',input:{type:'object',properties:{channel:{type:'string',minLength:1,maxLength:500}},required:['channel'],additionalProperties:false},output:{type:'object'},effect:'write',retry:'never-replay',authorize:async()=>true,implementation:{kind:'function',execute:(input,{actor})=>monitor.run(actor,input)}});
}
