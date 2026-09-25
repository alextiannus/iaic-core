import {defineCapability} from '../capabilities/index.js';
import {pageInput,agentInput} from './contracts.js';
export function createOperationsCapabilities({operations,prefix='operations'}) {
 return ['agents','agent','overview'].map(name=>{
  const execute=(input,{actor})=>name==='agent'?operations.agent(actor,input.id):operations[name](actor,input);
  return defineCapability({name:prefix+'.'+name,description:'Read currently authorized Agent operation evidence. Missing or stale telemetry is not healthy. This does not control execution.',input:name==='agent'?agentInput:pageInput,output:{type:'object'},effect:'read',authorize:async()=>true,revalidate:(input,_old,context)=>execute(input,context),implementation:{kind:'function',execute}});
 });
}
