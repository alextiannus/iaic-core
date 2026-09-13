import {withExecutionSignal} from '../context/execution.js';

// One bounded, authorized read per tick. PostgreSQL owns the wait and wake receipt;
// this cursor only provides fair polling and can be discarded on restart.
export class ResultWaits {
 constructor({store,dispatcher,version,authorizeTask,intervalMs=1000,timeoutMs=5000,admitRead=async()=>null,settleRead=async()=>{}}) {
  Object.assign(this,{store,dispatcher,version,authorizeTask,intervalMs,timeoutMs,admitRead,settleRead});this.cursor=null;this.nextCheck=0;
 }
 async tick() {
  if(Date.now()<this.nextCheck)return null;
  this.nextCheck=Date.now()+this.intervalMs;
  let task=await this.store.pendingResultWait(this.version,this.cursor);
  if(!task&&this.cursor){this.cursor=null;task=await this.store.pendingResultWait(this.version);}
  if(!task)return null;
  this.cursor=task.id;
  const controller=new AbortController();let timer;
  try {
   return await Promise.race([
    withExecutionSignal(controller.signal,async()=>{
     const actor=this.store.actor(task),capability=this.dispatcher.capabilities.get(task.wait_capability);
     if(capability?.effect!=='read'||typeof capability.waitReady!=='function')return null;
     await this.authorizeTask(actor,task,task.wait_capability);
     const callId=await this.admitRead(actor,task,{name:task.wait_capability,input:task.wait_input});
     let result;try{result=await this.dispatcher.invoke(task.wait_capability,task.wait_input,{actor,callId,signal:controller.signal});await this.settleRead(task,callId,'returned').catch(()=>{});}
     catch(error){await this.settleRead(task,callId,'unknown').catch(()=>{});throw error;}
     if(await capability.waitReady(task.wait_input,result,{actor})!==true)return null;
     controller.signal.throwIfAborted();
     // Cancellation, a manual resume or a newer wait wins over this stale observation.
     return await this.store.wakeResultWait(actor,task.id,{version:this.version,waitSeq:task.wait_seq,callId:task.wait_call_id});
    }),
    new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(null);},this.timeoutMs);})
   ]);
  }catch{return null;}finally{clearTimeout(timer);}
 }
}
