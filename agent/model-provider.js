import {invocationConfig} from './invocation.js';
import {OpenAIProvider,readBoundedResponse} from './openai-provider.js';

// Translate the wire protocol only. The shared provider still enforces one
// configured action, bounded responses and omission of hidden reasoning.
export function createModelProvider({apiKey,model,provider='openai',baseUrl='',fetchImpl=fetch,maxOutputTokens=4096,invocation}){
 const policy=invocationConfig(invocation).invocation;
 if(provider==='openai'){
  if(baseUrl)throw new Error('Custom base URL requires the chat-completions provider');
  return new OpenAIProvider({apiKey,model,fetchImpl,maxOutputTokens,invocation:policy});
 }
 if(provider!=='chat-completions')throw new Error('Unsupported IAIC_PROVIDER');
 const endpoint=new URL(baseUrl);
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw new Error('IAIC_MODEL_BASE_URL must be a plain HTTPS endpoint');
 endpoint.pathname=endpoint.pathname.replace(/\/$/,'')+'/chat/completions';
 const transport=async(_url,options)=>{
  const request=JSON.parse(options.body);
  const response=await fetchImpl(endpoint.href,{...options,body:JSON.stringify({model:request.model,messages:request.input,
   tools:request.tools.map(({type,name,description,parameters})=>({type,function:{name,description,parameters}})),
   tool_choice:request.tool_choice,parallel_tool_calls:request.parallel_tool_calls,temperature:0,
   ...(policy?.reasoningEffort===undefined?{}:{reasoning_effort:policy.reasoningEffort}),
   ...(policy?.maxCompletionTokens===undefined?{max_tokens:request.max_output_tokens}:{max_completion_tokens:request.max_output_tokens}),stream:false})});
  if(!response.ok)return response;
  const body=JSON.parse(await readBoundedResponse(response,2_000_000));
  const choice=body.choices?.length===1?body.choices[0]:null;
  const usage=body.usage?{input_tokens:body.usage.prompt_tokens,output_tokens:body.usage.completion_tokens,total_tokens:body.usage.total_tokens,
   input_tokens_details:body.usage.prompt_tokens_details,output_tokens_details:body.usage.completion_tokens_details}:null;
  return new Response(JSON.stringify({id:body.id||response.headers?.get('x-request-id')||null,provider_usage:body.usage??null,status:['tool_calls','stop'].includes(choice?.finish_reason)?'completed':'incomplete',
   completion_reason:['stop','tool_calls','length','content_filter','insufficient_system_resource'].includes(choice?.finish_reason)?choice.finish_reason:'unknown',usage,
   output:(choice?.finish_reason==='tool_calls'?(choice.message?.tool_calls||[]):[]).map(call=>({type:call.type==='function'?'function_call':'unsupported',name:call.function?.name,arguments:call.function?.arguments}))}));
 };
 return new OpenAIProvider({apiKey,model,fetchImpl:transport,maxOutputTokens,invocation:{...policy,toolChoice:policy?.toolChoice??'auto'}});
}
