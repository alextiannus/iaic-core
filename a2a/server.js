import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

// Optional SDK is loaded only when this surface is constructed.
export async function createCapabilityA2AHandler({dispatcher,capability,resolveAccess,url,name=capability,version='1',taskBindings=null,securitySchemes={},securityRequirements=[]}){
 const {AgentCard,Message,Task,Role,TaskState}=await import('@a2a-js/sdk');
 const {JsonRpcTransportHandler,ServerCallContext,validateVersion}=await import('@a2a-js/sdk/server');
 const {A2AError,UnsupportedOperationError,ContentTypeNotSupportedError,RequestMalformedError,TaskNotFoundError,TaskNotCancelableError}=await import('@a2a-js/sdk/errors');
 const cap=dispatcher?.capabilities?.get(capability),endpoint=new URL(url);
 if(!cap||typeof resolveAccess!=='function'||!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw new Error('A2A requires a configured capability, access resolver and HTTP endpoint');
 if(cap.implementation.kind==='agent'&&(!taskBindings||['get','cancel','list'].some(k=>!taskBindings[k])||typeof taskBindings.project!=='function'))throw new Error('Persistent A2A requires get/cancel/list capability bindings and a public task projection');
 const card=AgentCard.fromJSON({name,description:cap.description,version,supportedInterfaces:[{url:endpoint.href,protocolBinding:'JSONRPC',protocolVersion:'1.0'}],capabilities:{streaming:false,pushNotifications:false},securitySchemes,securityRequirements,defaultInputModes:['application/json'],defaultOutputModes:['application/json'],skills:[{id:cap.name,name:cap.name,description:cap.description,tags:['iaic-capability'],inputModes:['application/json'],outputModes:['application/json']}]});
 const unsupported=async()=>{throw new UnsupportedOperationError('Operation is not supported by this interface');};
 return async request=>{
  const path=new URL(request.url).pathname;
  if(path!==endpoint.pathname&&path!=='/.well-known/agent-card.json')return new Response(null,{status:404});
  let access;
  const current=async()=>{access=await resolveAccess(request);if(!access?.actor||!Array.isArray(access.capabilities)||!access.capabilities.includes(capability))throw Object.assign(new Error('Access denied'),{statusCode:403});return access;};
  try{await current();}catch{return Response.json({error:'Access denied'},{status:403});}
  if(path==='/.well-known/agent-card.json'&&request.method==='GET')return Response.json(AgentCard.toJSON(card),{headers:{'cache-control':'no-store'}});
  if(request.method!=='POST')return new Response(null,{status:405});
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return new Response(null,{status:415});
  const invoke=async(n,input,key)=>{const a=await current();return dispatcher.invoke(n,input,{actor:a.actor,allowedCapabilities:a.capabilities,callId:key,signal:request.signal});};
  const project=async result=>{const task=Task.fromJSON(await taskBindings.project(result));if(task.metadata?.iaicCapability!==capability)throw new TaskNotFoundError();return task;};
  const history=(task,length)=>{if(length!==undefined){if(!Number.isInteger(length)||length<0)throw new RequestMalformedError('Invalid historyLength');task.history=length===0?[]:task.history.slice(-length);}return task;};
  const query=async(id)=>{if(!taskBindings)throw new TaskNotFoundError();try{return await project(await invoke(taskBindings.get,{id}));}catch(e){if(e.statusCode===404)throw new TaskNotFoundError();throw e;}};
  const handler={
   getAgentCard:async()=>card,getAuthenticatedExtendedAgentCard:unsupported,
   async sendMessage(params){
    const m=params.message;
    if(!m||m.role!==Role.ROLE_USER||!m.messageId||m.messageId.length>200)throw new RequestMalformedError('A user message with a stable messageId is required');
    if(m.taskId||m.contextId||m.referenceTaskIds?.length)throw new UnsupportedOperationError('Use a new message; multi-turn/context attachment is not configured');
    if(m.parts.length!==1||m.parts[0].content?.$case!=='data')throw new ContentTypeNotSupportedError('Send one structured data part containing the capability input');
    if(params.configuration?.taskPushNotificationConfig)throw new UnsupportedOperationError('Push notifications are not supported');
    if(params.configuration?.acceptedOutputModes?.length&&!params.configuration.acceptedOutputModes.includes('application/json'))throw new ContentTypeNotSupportedError('This capability returns application/json');
    const value=await invoke(capability,m.parts[0].content.value,m.messageId);
    if(cap.implementation.kind!=='agent')return Message.fromJSON({messageId:randomUUID(),contextId:randomUUID(),role:Role.ROLE_AGENT,parts:[{data:value,mediaType:'application/json'}]});
    let task=await project(value);
    try{if(!params.configuration?.returnImmediately){while([TaskState.TASK_STATE_SUBMITTED,TaskState.TASK_STATE_WORKING].includes(task.status?.state)){await delay(100,undefined,{signal:request.signal});task=await query(task.id);}}}catch(error){error.outcomeUnknown=true;error.taskId=task.id;throw error;}
    return history(task,params.configuration?.historyLength);
   },
   async getTask(params){return history(await query(params.id),params.historyLength);},
   async cancelTask(params){if(!taskBindings)throw new TaskNotFoundError();await query(params.id);try{return await project(await invoke(taskBindings.cancel,{id:params.id},'a2a-cancel:'+params.id));}catch(e){if(e.statusCode===409)throw new TaskNotCancelableError();throw e;}},
   async listTasks(params){if(!taskBindings)return {tasks:[],nextPageToken:'',pageSize:0,totalSize:0};const result=await invoke(taskBindings.list,params);return {...result,tasks:await Promise.all(result.tasks.map(project))};},
   sendMessageStream:unsupported,resubscribe:unsupported,createTaskPushNotificationConfig:unsupported,getTaskPushNotificationConfig:unsupported,listTaskPushNotificationConfigs:unsupported,deleteTaskPushNotificationConfig:unsupported
  };
  for(const [key,fn] of Object.entries(handler)){handler[key]=async(...args)=>{try{return await fn(...args);}catch(error){if(error instanceof A2AError)throw error;throw new A2AError({message:error.statusCode&&error.statusCode<500?String(error.message).slice(0,500):'Capability operation failed; reconcile before replay',metadata:{statusCode:String(error.statusCode||500),outcomeUnknown:String(error.outcomeUnknown===true),...(error.taskId?{taskId:error.taskId}:{}),recovery:'Keep the messageId; query or reconcile before replay'}});}};}
  const transport=new JsonRpcTransportHandler(handler);
  let body;
  try{
   body=await request.text();const context=new ServerCallContext({requestedVersion:request.headers.get('a2a-version')||new URL(request.url).searchParams.get('A2A-Version')||'0.3'});
   validateVersion(context.requestedVersion,card,'JSONRPC');
   const response=await transport.handle(body,context);
   // Streaming is explicitly unadvertised; return a protocol error, not SSE.
   if(response?.[Symbol.asyncIterator])throw new UnsupportedOperationError();
   return Response.json(response,{headers:{'cache-control':'no-store','a2a-version':'1.0'}});
  }catch(error){let id=null;try{id=JSON.parse(body)?.id??null;}catch{}return Response.json({jsonrpc:'2.0',id,error:JsonRpcTransportHandler.mapToJSONRPCError(error)},{headers:{'cache-control':'no-store'}});}
 };
}
