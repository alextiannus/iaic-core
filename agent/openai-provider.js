import {invocationConfig} from './invocation.js';
import {wireToolNames} from './tool-names.js';
// OpenAI Responses API function calling; application verification remains local.
// https://developers.openai.com/api/docs/guides/function-calling
export class OpenAIProvider {
  #apiKey; #invocation;
  constructor({apiKey,model,fetchImpl=fetch,maxOutputTokens=4096,invocation}) {
    if(!apiKey||!model)throw new Error('OPENAI_API_KEY and IAIC_MODEL must be configured on the server');
    this.#invocation=invocationConfig(invocation).invocation||{};
    this.#apiKey=apiKey;this.name=model;this.fetch=fetchImpl;this.maxOutputTokens=this.#invocation.maxCompletionTokens??maxOutputTokens;
  }
  async next({messages,tools,outputSchema,delegationSchema,signal,maxBatchCalls=1}) {
    if(!Number.isInteger(maxBatchCalls)||maxBatchCalls<1||maxBatchCalls>8)throw new Error('Batch bound must be 1..8');
    const batchBound=this.#invocation.parallelToolCalls===false?1:maxBatchCalls;
    const providerMessages=this.#invocation.parallelToolCalls===false?[...messages,{role:'system',content:'This model invocation has a stricter one-action limit than any Runtime batch ceiling. Return exactly one function call. Do not return multiple tool calls or mix a tool with finish, wait or delegation. Wait for the result before choosing the next action.'}]:messages;
    const wireNames=wireToolNames(tools);
    const mapped=new Map(tools.map((tool,index)=>[wireNames[index],tool.name]));
    const definitions=tools.map((tool,index)=>({type:'function',name:wireNames[index],
      description:`${wireNames[index]}: ${tool.description}`,parameters:tool.inputSchema,strict:false}));
    definitions.push({type:'function',name:'iaic_finish',description:'Submit the final result for application verification. This does not by itself mark success.',
      parameters:{type:'object',properties:{result:outputSchema},required:['result'],additionalProperties:false},strict:false});
    definitions.push({type:'function',name:'iaic_wait',description:'Ask the user for essential missing information and pause the task.',
      parameters:{type:'object',properties:{question:{type:'string'}},required:['question'],additionalProperties:false},strict:true});
    if(delegationSchema)definitions.push({type:'function',name:'iaic_delegate',description:'Delegate one bounded subgoal to a child and pause until its result. The host fixes target, owner, model admission limit and deadline. After continuation, inspect child evidence and finish the original goal. Child success is not parent success.',parameters:delegationSchema,strict:false});
    const response=await this.fetch('https://api.openai.com/v1/responses',{
      method:'POST',signal,headers:{Authorization:`Bearer ${this.#apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:this.name,input:providerMessages,tools:definitions,tool_choice:this.#invocation.toolChoice??'required',parallel_tool_calls:batchBound>1,
        store:false,max_output_tokens:this.maxOutputTokens,
        ...(this.#invocation.reasoningEffort===undefined?{}:{reasoning:{effort:this.#invocation.reasoningEffort}})})
    });
    if(!response.ok){
      const value=response.headers?.get('retry-after');
      const retryAfterMs=value===null||value===undefined?null:/^\d+(?:\.\d+)?$/.test(value)?Number(value)*1000:Math.max(0,Date.parse(value)-Date.now());
      throw Object.assign(new Error(`Model API returned HTTP ${response.status}`),{providerStatus:response.status,...(Number.isFinite(retryAfterMs)?{retryAfterMs}:{} )});
    }
    const text=await readBoundedResponse(response,2_000_000);
    const body=JSON.parse(text);const usage=normalizeUsage(body.usage);
    const usageEvidence={rawUsage:body.provider_usage??body.usage??null,providerReference:body.id||response.headers?.get('x-request-id')||null};
    const error=(message,invalidAction=false)=>Object.assign(new Error(message),{usage,usageEvidence,invalidAction,providerCompleted:body.status==='completed'});
    const reason=['stop','tool_calls','length','content_filter','insufficient_system_resource','unknown'].includes(body.completion_reason)?`; finish_reason=${body.completion_reason}`:'';
    if(body.status!=='completed')throw error(`Model response not completed: ${body.status||'unknown'}${reason}`);
    const calls=(body.output||[]).filter(item=>item.type==='function_call');
    if(calls.length>1&&calls.length<=batchBound){
      const actions=calls.map(call=>{
        const name=mapped.get(call.name);let input;
        try{input=JSON.parse(call.arguments);}catch{throw error('Batch arguments must be JSON objects',true);}
        if(!name||!input||typeof input!=='object'||Array.isArray(input))throw error('Batch must contain only configured tool calls; control actions require a separate response',true);
        return {type:'call',name,input};
      });
      return {type:'batch',actions,usage,usageEvidence};
    }
    if(calls.length!==1)throw error(`Model must return exactly one action; received ${calls.length}. No action was executed. Use iaic_wait for missing information, iaic_finish for a proposed result, or one declared tool.`,true);
    const call=calls[0];let input;
    try{input=JSON.parse(call.arguments);}catch{throw error('Model action arguments are not valid JSON',true);}
    if(!input||typeof input!=='object'||Array.isArray(input))throw error('Model action arguments must be an object',true);
    if(call.name==='iaic_finish'){
      if(input.result===undefined)throw error('Model omitted its proposed result',true);
      return {type:'finish',result:input.result,usage,usageEvidence};
    }
    if(call.name==='iaic_wait'){
      if(typeof input.question!=='string'||!input.question.trim())throw error('Model omitted its input question',true);
      return {type:'wait',question:input.question,usage,usageEvidence};
    }
    if(call.name==='iaic_delegate'&&delegationSchema)return {type:'delegate',input,usage,usageEvidence};
    const name=mapped.get(call.name);if(!name)throw error(`Model selected an unconfigured capability. Use exactly one declared function name: ${[...mapped.keys(),'iaic_finish','iaic_wait'].join(', ')}`,true);
    return {type:'call',name,input,usage,usageEvidence};
  }
}
function normalizeUsage(value){
  if(!value)return null;
  const number=value=>Number.isFinite(value)&&value>=0?value:null;
  return {inputTokens:number(value.input_tokens),outputTokens:number(value.output_tokens),totalTokens:number(value.total_tokens),
    cachedInputTokens:number(value.input_tokens_details?.cached_tokens),reasoningOutputTokens:number(value.output_tokens_details?.reasoning_tokens)};
}

export async function readBoundedResponse(response,maxBytes){
  if(!response.body)return '';
  const reader=response.body.getReader();const chunks=[];let size=0;
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>maxBytes)throw new Error('Model response exceeds transport limit');
      chunks.push(value);
    }
    return Buffer.concat(chunks,size).toString('utf8');
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
}
