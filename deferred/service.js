const scopeFor=row=>({applicationId:row.application_id,assistantId:row.assistant_id,subjectId:row.subject_id});
const taskKey=row=>'deferred:'+row.id;
// The only dispatched side effect is an idempotent Task start. It is not a
// generic retry wrapper for arbitrary external business writes.
export class DeferredTasks{
 constructor({store,resolveScope,restoreActor,validateInput,startTask,findTask,triggers=null,isEnabled=()=>true,logger=console,reservedPrefixes=[]}){Object.assign(this,{store,resolveScope,restoreActor,validateInput,startTask,findTask,triggers,isEnabled,logger,reservedPrefixes});this.timer=null;this.running=null;}
 async schedule(actor,{requestKey,dueAt,input,trigger=null},{internal=false}={}){if(!internal&&typeof requestKey==='string'&&this.reservedPrefixes.some(prefix=>requestKey.startsWith(prefix)))throw Object.assign(new Error('Schedule request key prefix is reserved for internal dispatch'),{statusCode:400});const scope=await this.resolveScope(actor);await this.validateInput(actor,input,trigger);if(trigger!==null){if(!this.triggers)throw Object.assign(new Error('Trigger resolver unavailable'),{statusCode:400});trigger=await this.triggers.normalize(actor,trigger);}return this.store.create(scope,{requestKey,dueAt,input,trigger});}
 async get(actor,id){return this.store.get(await this.resolveScope(actor),id);}
 async findRequest(actor,key){return this.store.findRequest(await this.resolveScope(actor),key);}
 async list(actor,input){return this.store.list(await this.resolveScope(actor),input);}
 async cancel(actor,id){return this.store.change(await this.resolveScope(actor),id,'cancel');}
 async retry(actor,id){return this.store.change(await this.resolveScope(actor),id,'retry');}
 start(intervalMs=1000){if(this.timer)return;this.timer=setInterval(()=>this.tick().catch(e=>this.logger.error('Deferred task tick failed',{message:e.message})),intervalMs);this.timer.unref?.();}
 async stop(){if(this.timer)clearInterval(this.timer);this.timer=null;await this.running;}
 tick(){if(this.running)return this.running;this.running=this.dispatchNext().finally(()=>{this.running=null;});return this.running;}
 async dispatchNext(){
  if(!this.isEnabled())return null;const row=await this.store.claim();if(!row)return null;
  let admitted=Boolean(row.admitted_at);
  try{
   const actor=await this.restoreActor(scopeFor(row)),key=taskKey(row);
   const prior=await this.findTask(actor,key,row.input);
   if(prior){
    if(!row.admitted_at)throw Object.assign(new Error('Task key was occupied before deferred admission; it is not this intent receipt'),{statusCode:409});
    return await this.store.settle(row,{taskId:prior.id});
   }
   if(!this.isEnabled())throw new Error('Deferred dispatch paused');
   await this.validateInput(actor,row.input,row.trigger);
   let receipt=null;
   if(row.trigger){if(!this.triggers)throw Object.assign(new Error('Trigger resolver unavailable'),{statusCode:409});receipt=await this.triggers.check(actor,row.trigger);if(!receipt)return this.store.waitForTrigger(row);}
   if(!this.isEnabled())throw new Error('Deferred dispatch paused');
   await this.store.admit(row,receipt);admitted=true;
   const task=await this.startTask(actor,row.input,key);
   return await this.store.settle(row,{taskId:task.id});
  }catch(error){
   // A lost response is retried with the same key, never a new business action.
   return this.store.settle(row,{error:error.message,blocked:!admitted&&[400,401,403,404,409].includes(error.statusCode)});
  }
 }
}
