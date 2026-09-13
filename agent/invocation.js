// Optional model policy; omission preserves existing provider defaults and identities.
export function invocationConfig(value){
 if(value===undefined)return {};
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))
  ||Reflect.ownKeys(value).some(key=>!['toolChoice','parallelToolCalls'].includes(key)))throw new Error('Invalid model invocation policy');
 const policy={};
 if(Object.hasOwn(value,'toolChoice')){
  if(!['auto','required'].includes(value.toolChoice))throw new Error('Invalid tool choice');
  policy.toolChoice=value.toolChoice;
 }
 if(Object.hasOwn(value,'parallelToolCalls')){
  if(typeof value.parallelToolCalls!=='boolean')throw new Error('Invalid parallel tool calls policy');
  policy.parallelToolCalls=value.parallelToolCalls;
 }
 return {invocation:Object.freeze(policy)};
}
