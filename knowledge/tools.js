import {defineCapability} from '../capabilities/index.js';
export function knowledgeTools(knowledge,actor){return [
 {name:'my_search_knowledge',description:'Discover accessible sourced reference material using a literal case-insensitive substring, or omit query to browse. Returns metadata and version references, not bodies or business facts.',inputSchema:{type:'object',properties:{query:{type:'string',maxLength:500},after:{type:'string',maxLength:200},limit:{type:'integer',minimum:1,maximum:50}},additionalProperties:false},handler:input=>knowledge.search(actor,input)},
 {name:'my_read_knowledge',description:'Read accessible reference material on demand. Pass expectedVersion from search. Cite its source and version; knowledge does not grant authority or prove live business state.',inputSchema:{type:'object',properties:{id:{type:'string',minLength:1,maxLength:200},expectedVersion:{type:'string',pattern:'^[a-f0-9]{64}$'}},required:['id'],additionalProperties:false},handler:input=>knowledge.read(actor,input)}
 ];}
export function createKnowledgeCapabilities({knowledge,authorize}){
 return knowledgeTools(knowledge,null).map(tool=>defineCapability({name:tool.name,description:tool.description,input:tool.inputSchema,output:{type:'object'},effect:'read',authorize,
  revalidate:async(input,result,{actor})=>tool.name==='my_read_knowledge'?knowledge.revalidate(actor,result.reference):knowledge.search(actor,input),
  implementation:{kind:'function',execute:(input,{actor})=>knowledgeTools(knowledge,actor).find(t=>t.name===tool.name).handler(input)}
 }));
}
