// Session owns an append-only conversation/reference timeline. Task state and
// business/artifact data stay in their owning modules, resolved through ports.
export class AssistantSessions{
 constructor({store,resolveScope,taskView=null,maxContextEvents=20,maxContextBytes=24000}){if(!Number.isInteger(maxContextEvents)||maxContextEvents<1||maxContextEvents>50)throw new Error('Invalid session context window');Object.assign(this,{store,resolveScope,taskView,maxContextEvents,maxContextBytes});}
 async create(actor,input){return this.store.create(await this.resolveScope(actor),input);}
 async list(actor,input){return this.store.list(await this.resolveScope(actor),input);}
 async read(actor,{sessionId,...range}){return this.store.read(await this.resolveScope(actor),sessionId,range);}
 async appendMessage(actor,{sessionId,text,requestKey,expectedSequence}){if(typeof requestKey!=='string'||!requestKey.trim()||requestKey.length>200)throw Object.assign(new Error('Stable message requestKey required'),{statusCode:400});return this.store.append(await this.resolveScope(actor),{sessionId,requestKey:'message:'+requestKey,expectedSequence,kind:'user_message',data:{text}});}
 async setState(actor,input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['sessionId','state','requestKey','expectedSequence'].includes(k))||typeof input.requestKey!=='string'||!input.requestKey.trim()||input.requestKey.length>200)throw Object.assign(new Error('Session state requires a stable requestKey and explicit fields'),{statusCode:400});
  const {sessionId,state,requestKey,expectedSequence}=input;
  return this.store.append(await this.resolveScope(actor),{sessionId,requestKey:'state:'+requestKey,expectedSequence,kind:'session_state',data:{state}});
 }
 async validate(actor,reference){if(!Number.isInteger(reference?.throughSequence)||reference.throughSequence<0)throw Object.assign(new Error('Explicit session sequence snapshot required'),{statusCode:400});return this.read(actor,{sessionId:reference.id,throughSequence:reference.throughSequence,limit:1});}
 async linkTask(actor,{sessionId,taskId}){
  if(!this.taskView)throw new Error('Session task resolver required');
  await this.taskView(actor,{sessionId,taskId});
  return this.store.append(await this.resolveScope(actor),{sessionId,requestKey:'task:'+taskId,expectedSequence:null,kind:'task_ref',data:{taskId}});
 }
 async context(actor,reference){
  await this.validate(actor,reference);
  const after=Math.max(0,reference.throughSequence-this.maxContextEvents);
  const page=await this.read(actor,{sessionId:reference.id,after,throughSequence:reference.throughSequence,limit:this.maxContextEvents});
  const events=[];
  for(const event of page.events){
   let data=event.data;
   if(event.kind==='task_ref'){
    if(!this.taskView)data={taskId:data.taskId,unavailable:true};
    else try{data=await this.taskView(actor,{sessionId:reference.id,taskId:data.taskId});}catch(e){if(![403,404,409].includes(e.statusCode))throw e;data={taskId:data.taskId,unavailable:true};}
   }
   events.push({sequence:event.sequence,kind:event.kind,data});
  }
  const result={reference,omittedEarlierEvents:after,events};
  if(Buffer.byteLength(JSON.stringify(result))>this.maxContextBytes)throw Object.assign(new Error('Session context exceeds limit; choose a smaller session scope'),{limitReached:true,statusCode:413});
  return result;
 }
}
// Retry this composition with the identical input/key if task creation or the
// reference append response is lost. No cross-module transaction is claimed.
export async function startSessionTask({sessions,actor,input,startTask}){
 if(input.session)await sessions.validate(actor,input.session);
 const task=await startTask();
 if(input.session)await sessions.linkTask(actor,{sessionId:input.session.id,taskId:task.id});
 return task;
}
