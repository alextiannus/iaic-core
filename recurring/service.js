// Materialize one durable occurrence; the existing DeferredTasks and Task
// Runtime own dispatch, model calls, allowance and business execution.
export class RecurringTasks {
 constructor({store,resolveScope,restoreActor,validateInput,scheduleOccurrence,isEnabled=()=>true,logger=console}){Object.assign(this,{store,resolveScope,restoreActor,validateInput,scheduleOccurrence,isEnabled,logger});this.timer=null;this.running=null;}
 async create(actor,input){const scope=await this.resolveScope(actor);await this.validateInput(actor,input.input);return this.store.create(scope,input);}
 async get(actor,id){return this.store.get(await this.resolveScope(actor),id);}
 async list(actor,input){return this.store.list(await this.resolveScope(actor),input);}
 async change(actor,input){return this.store.change(await this.resolveScope(actor),input);}
 start(intervalMs=1000){if(this.timer)return;this.timer=setInterval(()=>this.tick().catch(e=>this.logger.error('Recurring task tick failed',{message:e.message})),intervalMs);this.timer.unref?.();}
 async stop(){if(this.timer)clearInterval(this.timer);this.timer=null;await this.running;}
 tick(){if(this.running)return this.running;this.running=this.dispatchNext().finally(()=>{this.running=null;});return this.running;}
 async dispatchNext(){
  if(!this.isEnabled())return null;const row=await this.store.claim();if(!row)return null;
  try{
   const actor=await this.restoreActor({applicationId:row.application_id,assistantId:row.assistant_id,subjectId:row.subject_id});
   await this.validateInput(actor,row.input);
   if(!this.isEnabled())throw new Error('Recurring dispatch paused');
   const dueAt=new Date(new Date(row.first_at).getTime()+row.pending_sequence*row.interval_seconds*1000).toISOString();
   const receipt=await this.scheduleOccurrence(actor,{requestKey:`recurring:${row.id}:${row.pending_sequence}`,dueAt,input:row.input});
   return await this.store.settle(row,{intentId:receipt.id});
  }catch(e){return this.store.settle(row,{error:e.message});}
 }
}
