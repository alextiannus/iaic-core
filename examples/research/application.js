import {isDeepStrictEqual} from 'node:util';
import {defineCapability} from '@immedi/iaic-core/capabilities/index.js';
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const text={type:'string',minLength:1,maxLength:4000};
const ids={type:'array',items:{type:'string',minLength:1,maxLength:100},minItems:1,maxItems:8,uniqueItems:true};
const report=object({title:text,sections:{type:'array',minItems:1,maxItems:12,items:object({claim:text,evidence:{type:'array',minItems:1,maxItems:8,items:object({documentId:text,quote:text})}})}});
const fail=(message,statusCode=422)=>Object.assign(new Error(message),{statusCode});

// Example application code: Core does not own these documents or report rules.
export function researchCapabilities({documents,workspace,canRead}){
 const accessible=async(actor,names)=>{for(const id of names)if(!documents.some(d=>d.id===id)||await canRead(actor,id)!==true)return false;return true;};
 const read=async(actor,id)=>{if(!await accessible(actor,[id]))throw fail('Document unavailable',403);return structuredClone(documents.find(d=>d.id===id));};
 const validate=async(actor,input)=>{
  for(const section of input.report.sections)for(const citation of section.evidence){
   if(!input.documentIds.includes(citation.documentId))throw fail('Citation outside requested documents');
   const source=await read(actor,citation.documentId);
   if(source.kind!=='source'||!source.text.includes(citation.quote))throw fail('Quote must exactly match an authorized source document');
  }
 };
 const stored=async(actor,input,result)=>{
  await validate(actor,input);
  const artifact=await workspace.read(actor,result.reference);
  if(!isDeepStrictEqual(JSON.parse(artifact.content),input))throw fail('Saved report does not match original input');
  return result;
 };
 const saveInput=object({documentIds:ids,report});
 const search=async(input,{actor})=>{
  const result=[];for(const id of input.documentIds){const doc=await read(actor,id);if(!input.query||doc.text.toLowerCase().includes(input.query.toLowerCase())||doc.title.toLowerCase().includes(input.query.toLowerCase()))result.push({id:doc.id,title:doc.title,kind:doc.kind});}return result;
 };
 const capabilities=[
  defineCapability({name:'documents.search',description:'Search only the requested document IDs. Empty query lists the entire scoped collection.',input:object({documentIds:ids,query:{type:'string',maxLength:200}}),output:{type:'array',items:{type:'object'}},effect:'read',authorize:(a,i)=>accessible(a,i.documentIds),implementation:{kind:'function',execute:search},revalidate:(i,_r,c)=>search(i,c)}),
  defineCapability({name:'documents.read',description:'Read one currently authorized source document or old draft. Drafts are claims to check, not source evidence.',input:object({id:text}),output:{type:'object'},effect:'read',authorize:(a,i)=>accessible(a,[i.id]),implementation:{kind:'function',execute:(i,{actor})=>read(actor,i.id)},revalidate:(i,_r,{actor})=>read(actor,i.id)}),
  defineCapability({name:'reports.save',description:'Save a report with exact source quotations. The saved reference is the final artifact. This checks evidence presence, not semantic quality.',input:saveInput,output:{type:'object'},effect:'write',retry:'idempotent',authorize:(a,i)=>accessible(a,i.documentIds),preflight:async(i,{actor})=>{try{await validate(actor,i);return true;}catch(e){if(e.statusCode!==422)throw e;return {valid:false,feedback:e.message};}},implementation:{kind:'function',execute:async(input,{actor,callId})=>{
   if(typeof callId!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(callId))throw fail('A stable application request key is required',400);
   await validate(actor,input);const path='reports/'+callId+'.json';
   try{const saved=await workspace.write(actor,{path,content:JSON.stringify(input),mediaType:'application/json',expectedRevision:0});return {reference:saved.reference};}
   catch(e){if(e.statusCode!==409)throw e;const existing=await workspace.read(actor,{path});return stored(actor,input,{reference:existing.reference});}
  }},verify:async(i,r,{actor})=>{await stored(actor,i,r);return true;},revalidate:(i,r,{actor})=>stored(actor,i,r),reconcile:async(i,{actor,callId})=>{try{const prior=await workspace.read(actor,{path:'reports/'+callId+'.json'});return {confirmed:true,result:await stored(actor,i,{reference:prior.reference})};}catch(e){if([404,422].includes(e.statusCode))return {confirmed:false};throw e;}}})
 ];
 capabilities.push(defineCapability({name:'research.prepare',description:'Pursue a research goal using specified documents and deliver a sourced report.',input:object({goal:text,documentIds:ids}),output:{type:'object'},effect:'write',retry:'idempotent',authorize:(a,i)=>accessible(a,i.documentIds),implementation:{kind:'agent',instructions:'Fulfil the research goal using the installed research method. Finish with the exact {reference} returned by reports.save. Choose tool order from evidence and feedback.',tools:capabilities.map(c=>c.name),skills:['skills/research.md'],allowCall:async(input,action)=>action.name==='documents.read'?input.documentIds.includes(action.input.id):isDeepStrictEqual(input.documentIds,action.input.documentIds),verify:async(input,result,{actor})=>{
  const artifact=await workspace.read(actor,result.reference);const saved=JSON.parse(artifact.content);
  if(!isDeepStrictEqual(saved.documentIds,input.documentIds))return false;
  await validate(actor,saved);return true;
 }}}));
 return capabilities;
}
