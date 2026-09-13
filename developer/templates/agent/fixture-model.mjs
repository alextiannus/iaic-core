// Test-only deterministic provider. The real server never imports this file.
import {job,skillRoot,sourceRevision} from './config.mjs';
export const fixtureOptions={runtimeLimits:{maxTurns:12,maxCalls:12,maxBatchCalls:4},job,skillRoot,version:sourceRevision,profiles:['system','alternate'].map(id=>({id,provider:'openai',model:id,credentialRef:'fixture'})),resolveSecret:()=> 'fixture-only',authorize:a=>Boolean(a.subjectId&&a.scopeId),tokenPolicies:Object.fromEntries(['system','alternate'].map(id=>[id,{maximum:100,price:{revision:'fixture-units',input:1,cachedInput:1,output:1}}])),
 modelFactory:({model})=>({next:async({messages})=>{
  const c=JSON.parse(messages[1].content),calls=c.calls.filter(x=>x.status==='succeeded');let action;
  if(calls.length===0)action={type:'call',name:'my_read_assistant_memory',input:{key:'style'}};
  else if(calls.length===1)action={type:'call',name:'assistant.skills.list',input:{}};
  else if(calls.length===2)action={type:'call',name:'assistant.skills.read',input:{id:calls[1].result[0].id}};
  else if(calls.length===3)action={type:'call',name:'my_search_knowledge',input:{}};
  else if(calls.length===4)action={type:'call',name:'my_read_knowledge',input:{id:calls[3].result.items[0].reference.id}};
  else if(calls.length===5)action={type:'call',name:'my_write_workspace',input:{path:'draft.md',content:JSON.stringify({style:calls[0].result.content,guide:calls[4].result.text,model,session:c.session?.events.filter(e=>e.kind==='user_message').map(e=>e.data.text)}),expectedRevision:0}};
  else if(calls.length===6)action={type:'call',name:'my_read_workspace',input:{path:'draft.md'}};
  else action={type:'finish',result:{summary:'Prepared the requested fixture artifact.',artifacts:[calls[6].result.reference]}};
  return {...action,usage:{inputTokens:1,outputTokens:1}};
 }}),verifyOutcome:async(_input,result,{history})=>result.artifacts.length===1&&history.calls.some(c=>c.capability==='my_read_workspace'&&c.status==='succeeded')};
