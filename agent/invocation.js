// Optional model policy; omission preserves existing provider defaults and identities.
export function invocationConfig(value){
 if(value===undefined)return {};
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))
  ||Reflect.ownKeys(value).some(key=>!['toolChoice','parallelToolCalls','maxCompletionTokens','reasoningEffort'].includes(key)))throw new Error('Invalid model invocation policy');
 const policy={};
 if(Object.hasOwn(value,'toolChoice')){
  if(!['auto','required'].includes(value.toolChoice))throw new Error('Invalid tool choice');
  policy.toolChoice=value.toolChoice;
 }
 if(Object.hasOwn(value,'parallelToolCalls')){
  if(typeof value.parallelToolCalls!=='boolean')throw new Error('Invalid parallel tool calls policy');
  policy.parallelToolCalls=value.parallelToolCalls;
 }
 if(Object.hasOwn(value,'maxCompletionTokens')){
  if(!Number.isSafeInteger(value.maxCompletionTokens)||value.maxCompletionTokens<1||value.maxCompletionTokens>1048576)throw new Error('Invalid total completion Token limit');
  policy.maxCompletionTokens=value.maxCompletionTokens;
 }
 if(Object.hasOwn(value,'reasoningEffort')){
  if(!['none','minimal','low','medium','high','xhigh','max'].includes(value.reasoningEffort))throw new Error('Invalid reasoning effort');
  policy.reasoningEffort=value.reasoningEffort;
 }
 return {invocation:Object.freeze(policy)};
}
