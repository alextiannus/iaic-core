import {capabilityVisible,assertCapabilitySurface,validateSurface} from '../capabilities/visibility.js';
import {publicErrorFields} from '../capabilities/errors.js';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {CallToolRequestSchema,ListToolsRequestSchema,McpError,ErrorCode} from '@modelcontextprotocol/sdk/types.js';
const fail=(message,statusCode)=>Object.assign(new Error(message),{statusCode});
const requiresKey=cap=>cap.effect==='write'||cap.implementation.kind==='agent';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
// Protocol only: identity, capability access, Task execution, idempotency and
// domain effects remain owned by the injected host/dispatcher/domain ports.
export function createCapabilityMcpServer({dispatcher,resolveAccess,serverInfo={name:'iaic-capabilities',version:'0.1.0'},surface='model'}){
 validateSurface(surface);
 if(!dispatcher?.capabilities||typeof dispatcher.invoke!=='function'||typeof resolveAccess!=='function')throw new Error('MCP requires a dispatcher and current access resolver');
 const server=new Server(serverInfo,{capabilities:{tools:{}}});
 const accessFor=async extra=>{
  const access=await resolveAccess(extra);
  if(!access?.actor||!Array.isArray(access.capabilities)||access.capabilities.some(name=>typeof name!=='string')||new Set(access.capabilities).size!==access.capabilities.length)throw fail('MCP access denied',403);
  const capabilities=access.capabilities.map(name=>{const cap=dispatcher.capabilities.get(name);if(!cap)throw fail('MCP host capability configuration is invalid',500);return cap;});
  return {actor:access.actor,capabilities};
 };
 server.setRequestHandler(ListToolsRequestSchema,async(request,extra)=>{
  if(request.params?.cursor!==undefined)throw new McpError(ErrorCode.InvalidParams,'This capability catalog does not use pagination');
  let access;try{access=await accessFor(extra);}catch(error){throw new McpError(ErrorCode.InvalidRequest,'MCP access unavailable',{statusCode:error.statusCode||500});}
  return {tools:access.capabilities.filter(cap=>capabilityVisible(cap,surface)).map(cap=>{
   const agent=cap.implementation.kind==='agent',readOnly=!agent&&cap.effect==='read';
   return {name:cap.name,description:cap.description+(agent?' Returns a durable Task admission receipt, not a completed business result.':'')+(requiresKey(cap)?' Supply a stable requestKey alongside input; reuse it for the same operation.':''),inputSchema:{type:'object',properties:{input:{$id:'urn:iaic:mcp:input:'+encodeURIComponent(cap.name),...cap.input},requestKey:{type:'string',minLength:1,maxLength:200}},required:['input',...(requiresKey(cap)?['requestKey']:[])],additionalProperties:false},
    ...(!agent&&cap.output.type==='object'?{outputSchema:cap.output}:{}),annotations:{readOnlyHint:readOnly,idempotentHint:readOnly||(!agent&&cap.retry==='idempotent')},execution:{taskSupport:'forbidden'},
    _meta:{'iaic/capability':cap.name,'iaic/requestKeyRequired':requiresKey(cap),'iaic/result':agent?'task-receipt':'capability-result'}};
  })};
 });
 server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
  let cap,key,started=false;
  try{
   const access=await accessFor(extra);cap=access.capabilities.find(cap=>cap.name===request.params.name);
   if(!cap)throw new McpError(ErrorCode.InvalidParams,'Tool is not available to this caller');
   assertCapabilitySurface(cap,surface);
   if(request.params.task!==undefined)throw fail('MCP task-augmented execution is unsupported; Agent tools return application Task receipts',400);
   const envelope=request.params.arguments??{};
   if(!Object.hasOwn(envelope,'input')||Object.keys(envelope).some(key=>!['input','requestKey'].includes(key)))throw fail('Arguments require input and optionally requestKey only',400);
   key=envelope.requestKey;
   if(key!==undefined&&(typeof key!=='string'||!key.trim()||key.length>200))throw fail('Invalid stable request key',400);
   if(requiresKey(cap)&&key===undefined)throw fail('A stable requestKey is required',400);
   started=true;
   const result=await dispatcher.invoke(cap.name,envelope.input,{actor:access.actor,callId:key??null,signal:extra.signal,allowedCapabilities:access.capabilities.map(cap=>cap.name),surface});
   return {content:[{type:'text',text:JSON.stringify(result)}],...(object(result)?{structuredContent:result}:{})};
  }catch(error){
   if(error instanceof McpError)throw error;
   const statusCode=Number.isInteger(error.statusCode)?error.statusCode:500;
   const outcomeUnknown=error.outcomeUnknown===true||(started&&cap?.implementation.kind==='agent'&&statusCode>=500);
   const details={...publicErrorFields(error),message:statusCode<500?String(error.message).slice(0,2000):'Capability execution failed',statusCode,outcomeUnknown,
    ...(typeof error.code==='string'?{code:error.code}:{}),...(Array.isArray(error.validation)?{validation:error.validation.slice(0,20).map(({instancePath,keyword,message})=>({path:instancePath,keyword,message}))}:{}),...(typeof key==='string'?{requestKey:key}:{}),
    ...(outcomeUnknown?{recovery:'Query or reconcile the existing operation before retrying. Do not use a new request key to bypass an unknown result.'}:{})};
   return {isError:true,content:[{type:'text',text:JSON.stringify({error:details})}]};
  }
 });
 return server;
}
