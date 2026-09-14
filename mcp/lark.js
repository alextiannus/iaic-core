import {readFileSync} from 'node:fs';
import {discoverMcpTools, importMcpCapabilities} from './client.js';

// Reviewed against @larksuiteoapi/lark-mcp 0.5.1. No provider SDK dependency in Core.
export const LARK_TOOL_CATALOG=Object.freeze(JSON.parse(readFileSync(new URL('./lark-catalog.json',import.meta.url),'utf8')).map(Object.freeze));
const fail=message=>Object.assign(new Error(message),{statusCode:400});
export function selectLarkTools({domains=['im'],tools=[]}={}) {
  if(!Array.isArray(domains)||!Array.isArray(tools))throw fail('Lark domains and tools must be arrays');
  for(const domain of domains)if(!LARK_TOOL_CATALOG.some(row=>row.domain===domain))throw fail(`Unknown Lark domain: ${domain}`);
  for(const tool of tools)if(!LARK_TOOL_CATALOG.some(row=>row.tool===tool))throw fail(`Unreviewed Lark tool: ${tool}`);
  return LARK_TOOL_CATALOG.filter(row=>domains.includes(row.domain)||tools.includes(row.tool));
}

/** Import a selected official MCP catalog into the existing CapabilityDispatcher. */
export async function importLarkCapabilities({client,resolveClient,authorize,identity,domains,tools,toolNameCase='snake',signal}={}) {
  if(!['user','bot'].includes(identity)||typeof authorize!=='function'||typeof resolveClient!=='function')throw fail('Lark import requires fixed user/bot identity, authorization and current client resolution');
  if(!['snake','dot'].includes(toolNameCase))throw fail('Lark tool naming must be snake or dot');
  const catalog=await discoverMcpTools(client,{signal});
  const bindings=selectLarkTools({domains,tools}).map(row=>{
    const tool=toolNameCase==='snake'?row.tool.replaceAll('.','_'):row.tool;
    const remote=catalog.find(item=>item.name===tool);
    if(!remote)throw fail(`Selected Lark tool unavailable: ${row.tool}; enable it in the server and check token mode`);
    const input=structuredClone(remote.inputSchema);
    if(input.type!=='object')throw fail('Lark tools require object input schemas');
    // Identity is host configuration; the model cannot select another token mode.
    if(input.properties)delete input.properties.useUAT;
    if(input.required)input.required=input.required.filter(key=>key!=='useUAT');
    input.additionalProperties=false;
    return {name:'lark.'+row.tool.toLowerCase(),tool,effect:row.effect,input,
      authorize:(actor,value,context)=>authorize(actor,value,{...context,lark:{...row,identity}}),
      toArguments:value=>({...value,useUAT:identity==='user'})};
  });
  return importMcpCapabilities({client:{listTools:async()=>({tools:catalog})},signal,bindings,
    resolveClient:context=>resolveClient({...context,larkIdentity:identity})});
}
