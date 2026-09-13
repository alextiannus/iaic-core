import {wireToolNames} from './tool-names.js';
// OpenAI Responses API function calling; application verification remains local.
// https://developers.openai.com/api/docs/guides/function-calling
export class OpenAIProvider {
  #apiKey;
  constructor({apiKey,model,fetchImpl=fetch,maxOutputTokens=4096}) {
    if(!apiKey||!model)throw new Error('OPENAI_API_KEY and IAIC_MODEL must be configured on the server');
    this.#apiKey=apiKey;this.name=model;this.fetch=fetchImpl;this.maxOutputTokens=maxOutputTokens;
  }
  async next({messages,tools,outputSchema,delegationSchema,signal}) {
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
      body:JSON.stringify({model:this.name,input:messages,tools:definitions,tool_choice:'required',parallel_tool_calls:false,
        store:false,max_output_tokens:this.maxOutputTokens})
    });
    if(!response.ok){
      const value=response.headers?.get('retry-after');
      const retryAfterMs=value===null||value===undefined?null:/^\d+(?:\.\d+)?$/.test(value)?Number(value)*1000:Math.max(0,Date.parse(value)-Date.now());
      throw Object.assign(new Error(`Model API returned HTTP ${response.status}`),{providerStatus:response.status,...(Number.isFinite(retryAfterMs)?{retryAfterMs}:{} )});
    }
    const text=await readBoundedResponse(response,2_000_000);
    const body=JSON.parse(text);const usage=normalizeUsage(body.usage);
    const usageEvidence={rawUsage:body.provider_usage??body.usage??null,providerReference:body.id||response.headers?.get('x-request-id')||null};
    const error=(message,invalidAction=false)=>Object.assign(new Error(message),{usage,usageEvidence,invalidAction});
    const reason=['stop','tool_calls','length','content_filter','insufficient_system_resource','unknown'].includes(body.completion_reason)?`; finish_reason=${body.completion_reason}`:'';
    if(body.status!=='completed')throw error(`Model response not completed: ${body.status||'unknown'}${reason}`);
    const calls=(body.output||[]).filter(item=>item.type==='function_call');
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
