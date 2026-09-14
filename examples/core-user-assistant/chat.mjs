import {createInterface} from 'node:readline/promises';
import {randomUUID} from 'node:crypto';
import {CapabilityHttpClient} from '@immedi/iaic-core/http/client.js';
import {tools} from './application.mjs';
if(!process.env.APP_TOKEN)throw Error('Set APP_TOKEN');
const client=new CapabilityHttpClient({url:process.env.ASSISTANT_URL||'http://127.0.0.1:3012/capabilities',headers:()=>({authorization:'Bearer '+process.env.APP_TOKEN})});
const terminal=createInterface({input:process.stdin,output:process.stdout});
try{
 const goal=await terminal.question('What declaration would you like me to prepare and submit? ');
 const task=(await client.invoke('agent.work',{goal,allowedTools:tools},{requestKey:randomUUID()})).result;
 console.log('Task:',task.id,'— you can query this Task again after disconnecting.');
 for(;;){
  const state=(await client.invoke('tasks.get',{id:task.id})).result;
  if(['succeeded','failed','cancelled'].includes(state.status)){console.log(JSON.stringify(state.result??state,null,2));break;}
  if(state.status==='waiting'){
   if((state.waiting_reason??state.waitingReason)!=='input'){console.log(JSON.stringify(state,null,2));break;}
   console.log(JSON.stringify(state.inputRequest??{question:'Additional information is needed.'},null,2));
   const input=await terminal.question('Your answer (or /cancel): ');
   await client.invoke(input==='/cancel'?'tasks.cancel':'tasks.provide_input',{id:task.id,...(input==='/cancel'?{}:{input})},{requestKey:randomUUID()});
  }
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
}finally{terminal.close();}
