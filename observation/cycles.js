import {fail,key} from '../releases/store.js';
import {defineCapability} from '../capabilities/index.js';
const unknown=input=>Object.assign(fail('Monitor cycle requires original-result reconciliation',409),{outcomeUnknown:true,monitorCycle:input});
export class PersistentReleaseMonitor{
 constructor({monitor,store,resolveOwner,authorize}){
  if(typeof monitor?.run!=='function'||typeof monitor?.revalidate!=='function'||typeof monitor?.recoverProtection!=='function'||typeof store?.begin!=='function'||typeof resolveOwner!=='function'||typeof authorize!=='function')throw fail('Persistent monitor requires monitor, cycle store, owner and authorization ports');
  Object.assign(this,{monitor,store,resolveOwner,authorize});
 }
 async owner(actor,input,action){key(input.channel);key(input.requestKey);if(await this.authorize(actor,{...input,action})!==true)throw fail('Monitor cycle access denied',403);return key(await this.resolveOwner(actor));}
 async run(actor,input){
  input={channel:input.channel,requestKey:input.requestKey};const owner=await this.owner(actor,input,'run');
  const admission=await this.store.begin(owner,input);if(!admission.created)return this.recover(actor,input);
  try{
   const result=await this.monitor.run(actor,{channel:input.channel},{beforeProtection:async snapshot=>{
    if(await this.owner(actor,input,'run')!==owner)throw fail('Monitor cycle owner changed',403);
    await this.store.prepare(owner,input.requestKey,snapshot);
   }});
   return await this.store.complete(owner,input.requestKey,result);
  }catch(error){throw Object.assign(error,{outcomeUnknown:true,monitorCycle:input});}
 }
 async recover(actor,input){
  input={channel:input.channel,requestKey:input.requestKey};const owner=await this.owner(actor,input,'recover'),record=await this.store.get(owner,input.requestKey);
  if(record.channel!==input.channel)throw fail('Monitor cycle channel differs',409);
  if(record.state==='started')throw unknown(input);
  let result=record.result;
  if(record.state==='prepared'){
   const {willProtect,...snapshot}=record.snapshot;result=snapshot;
   if(willProtect){
    const receipt=await this.monitor.recoverProtection(actor,{channel:input.channel,assessmentId:snapshot.assessment.id,expectedRevision:snapshot.target.expectedRevision});
    if(receipt.status!=='confirmed')throw unknown(input);result={...snapshot,protection:receipt.protection};
   }
  }
  result=await this.monitor.revalidate({channel:input.channel},result,{actor});
  if(await this.owner(actor,input,'recover')!==owner)throw fail('Monitor cycle owner changed',403);
  return record.state==='completed'?result:this.store.complete(owner,input.requestKey,result);
 }
}
export function createMonitorCycleCapabilities({cycles,prefix='monitor_cycle'}){
 const input={type:'object',properties:{channel:{type:'string',minLength:1,maxLength:500},requestKey:{type:'string',minLength:1,maxLength:500}},required:['channel','requestKey'],additionalProperties:false};
 return ['run','recover'].map(action=>defineCapability({name:prefix+'.'+action,description:action==='run'?'Run one scoped persistent monitoring cycle with an explicit stable key. Reusing the key only reads/reconciles original results; it never restarts collection or protection.':'Recover the original monitoring cycle using its saved assessment and rollback receipt. Unknown results never trigger another protection action.',input,output:{type:'object'},effect:'write',retry:'idempotent',authorize:async()=>true,revalidate:(value,result,{actor})=>cycles.recover(actor,value),implementation:{kind:'function',execute:(value,{actor})=>cycles[action](actor,value)}}));
}
