import {defineCapability} from '../capabilities/index.js';

// The host approves a card and credentials. Discovery never installs remote code.
export async function importA2ACapabilities({agentCard,prefix,authorize,resolveHeaders,input={type:'object'},parts=value=>[{data:value,mediaType:'application/json'}],fetch:transport=globalThis.fetch,timeoutMs=30000}){
 const {AgentCard,Message,Task,Role}=await import('@a2a-js/sdk');
 const {ClientFactory,JsonRpcTransportFactory}=await import('@a2a-js/sdk/client');
 if(typeof authorize!=='function'||typeof resolveHeaders!=='function'||typeof parts!=='function'||typeof transport!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000)throw new Error('A2A import requires current authorization, credentials, transport and a bounded timeout');
 const card=AgentCard.fromJSON(structuredClone(agentCard));
 const selected=card.supportedInterfaces.find(i=>i.protocolBinding==='JSONRPC'&&i.protocolVersion==='1.0');
 if(!selected)throw new Error('A2A import requires an approved JSONRPC 1.0 interface');
 const endpoint=new URL(selected.url);
 if(!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password||endpoint.hash||endpoint.search)throw new Error('A2A endpoint must be an HTTP URL without embedded credentials');
 card.supportedInterfaces=[selected];
 const taskJson=task=>{if(!task?.id||!task.contextId||!Number.isInteger(task.status?.state)||task.status.state<1||task.status.state>8)throw new Error('Invalid remote task receipt');return Task.toJSON(task);};
 const messageJson=message=>{if(!message?.messageId||!message.contextId||message.role!==Role.ROLE_AGENT||!message.parts?.length)throw new Error('Invalid remote message');return Message.toJSON(message);};
 const idInput={type:'object',properties:{id:{type:'string',minLength:1,maxLength:500}},required:['id'],additionalProperties:false};
 const operations=[['send','write',input],['get','read',idInput],['cancel','write',idInput],['list','read',{type:'object'}]];
 return operations.map(([operation,effect,schema])=>defineCapability({name:prefix+'.'+operation,description:`${operation} work with the configured external A2A agent ${card.name}. A task receipt is pending work, not goal completion.`,input:schema,output:{type:'object'},effect,...(effect==='write'?{retry:'never-replay'}:{}),authorize,
 implementation:{kind:'function',execute:async(value,context)=>{
  const timeout=AbortSignal.timeout(timeoutMs),signal=context.signal?AbortSignal.any([context.signal,timeout]):timeout;
  signal.throwIfAborted();let sent=false;
  const fetchImpl=async(url,options)=>{
   if(new URL(url).href!==endpoint.href)throw new Error('A2A transport escaped its approved endpoint');
   const headers=new Headers(options?.headers);for(const [key,val] of new Headers(await resolveHeaders({...context,operation})))headers.set(key,val);
   signal.throwIfAborted();sent=true;
   return transport(url,{...options,headers,signal,redirect:'error'});
  };
  const client=await new ClientFactory({transports:[new JsonRpcTransportFactory({fetchImpl})]}).createFromAgentCard(card);
  try{
   if(operation==='send'){
    const message=Message.fromJSON({messageId:context.callId,role:Role.ROLE_USER,parts:await parts(value,context)});
    const result=await client.sendMessage({message,configuration:{returnImmediately:true}});
    return 'messageId' in result?{kind:'message',message:messageJson(result)}:{kind:'task',task:taskJson(result)};
   }
   if(operation==='get')return {kind:'task',task:taskJson(await client.getTask(value))};
   if(operation==='cancel')return {kind:'task',task:taskJson(await client.cancelTask(value))};
   const result=await client.listTasks(value);return {...result,tasks:result.tasks.map(taskJson)};
  }catch(cause){throw Object.assign(new Error('External A2A operation failed; query or reconcile before replay'),{statusCode:502,outcomeUnknown:sent&&effect==='write',requestKey:context.callId,remoteReason:typeof cause.reason==='string'?cause.reason:undefined});}
 }}}));
}
